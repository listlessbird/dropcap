//! A web article as an unpacked EPUB: fetch the page, keep what Readability calls the article,
//! and store its images as JPEGs beside it, so kindling builds it like any other book.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::Duration;

use dom_query::Document;
use dom_smoothie::Readability;
use ureq::ResponseExt;

use crate::{ConvertError, Stop, checkpoint, io};

// Some sites serve a stub or a block page to clients that do not look like a browser.
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MAX_PAGE_BYTES: u64 = 10 << 20;
const MAX_IMAGE_BYTES: u64 = 10 << 20;
const MAX_IMAGES: usize = 40;
/// The Paperwhite's screen is 1072 px wide; wider images only cost space.
const MAX_IMAGE_WIDTH: u32 = 1072;
/// Smaller images are icons and tracking pixels, not a cover.
const MIN_COVER_WIDTH: u32 = 300;

/// Writes the article at `url` into `dir` as `article.xhtml`, `images/` and the returned
/// `content.opf`. A page that cannot be reached is `Fetch`, which the app retries once online.
pub(crate) fn write(url: &str, dir: &Path, cancelled: &dyn Fn() -> bool) -> Result<PathBuf, Stop> {
    let agent = agent();
    let (page_url, html) = fetch_page(&agent, url)?;
    checkpoint(cancelled)?;

    let article = Readability::new(html, Some(&page_url), None)
        .and_then(|mut readability| readability.parse())
        .map_err(|error| ConvertError::Article(error.to_string()))?;
    let base = url::Url::parse(&page_url).map_err(|error| ConvertError::Article(error.to_string()))?;
    let host = base.host_str().unwrap_or_default().trim_start_matches("www.").to_owned();
    let title = non_empty(Some(article.title.clone())).unwrap_or_else(|| host.clone());
    let byline = non_empty(article.byline.clone());
    let site = non_empty(article.site_name.clone()).unwrap_or_else(|| host.clone());
    let author = byline.clone().unwrap_or_else(|| site.clone());

    std::fs::create_dir_all(dir.join("images")).map_err(io)?;
    let content = Document::fragment(article.content.clone());
    content.select("source, video, audio, iframe, object, embed, noscript").remove();

    let mut images = Vec::new();
    for img in content.select("img").nodes() {
        checkpoint(cancelled)?;
        let jpeg = (images.len() < MAX_IMAGES)
            .then(|| image_source(img.attr("src").as_deref(), img.attr("srcset").as_deref()))
            .flatten()
            .and_then(|src| fetch_image(&agent, &src, 0));
        match jpeg {
            Some(jpeg) => {
                let href = format!("images/{}.jpg", images.len() + 1);
                std::fs::write(dir.join(&href), &jpeg.bytes).map_err(io)?;
                img.remove_attrs(&["srcset", "sizes", "loading", "decoding", "width", "height", "style"]);
                img.set_attr("src", &href);
                images.push((href, jpeg));
            }
            None => img.remove_from_parent(),
        }
    }

    // The page's own preview image, or else the article's first large one.
    let cover = article
        .image
        .as_deref()
        .and_then(|src| base.join(src).ok())
        .and_then(|src| fetch_image(&agent, src.as_str(), MIN_COVER_WIDTH))
        .or_else(|| images.iter().find(|(_, jpeg)| jpeg.width >= MIN_COVER_WIDTH).map(|(_, jpeg)| jpeg.clone()));
    if let Some(cover) = &cover {
        std::fs::write(dir.join("cover.jpg"), &cover.bytes).map_err(io)?;
    }
    checkpoint(cancelled)?;

    let language = non_empty(article.lang.clone()).unwrap_or_else(|| "en".into());
    let header = [byline.as_deref(), Some(site.as_str())].into_iter().flatten().map(escape).collect::<Vec<_>>().join(" · ");
    let xhtml = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="{lang}" lang="{lang}">
<head><meta charset="utf-8"/><title>{title}</title></head>
<body>
<h1>{title}</h1>
<p><i>{header}</i></p>
{content}
<hr/>
<p><small>{url}</small></p>
</body>
</html>
"#,
        lang = escape(&language),
        title = escape(&title),
        content = content.html_root().inner_html(),
        url = escape(&page_url),
    );
    std::fs::write(dir.join("article.xhtml"), xhtml).map_err(io)?;

    let items: String = images
        .iter()
        .enumerate()
        .map(|(n, (href, _))| format!(r#"<item id="image{n}" href="{href}" media-type="image/jpeg"/>"#))
        .chain(cover.iter().map(|_| r#"<item id="cover" href="cover.jpg" media-type="image/jpeg"/>"#.to_owned()))
        .collect();
    let opf = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>{title}</dc:title><dc:creator>{author}</dc:creator><dc:publisher>{site}</dc:publisher>
<dc:identifier id="id">{url}</dc:identifier><dc:source>{url}</dc:source><dc:language>{lang}</dc:language>{cover_meta}
</metadata>
<manifest><item id="article" href="article.xhtml" media-type="application/xhtml+xml"/>{items}</manifest>
<spine><itemref idref="article"/></spine>
</package>
"#,
        title = escape(&title),
        author = escape(&author),
        site = escape(&site),
        url = escape(&page_url),
        lang = escape(&language),
        cover_meta = if cover.is_some() { r#"<meta name="cover" content="cover"/>"# } else { "" },
    );
    let opf_path = dir.join("content.opf");
    std::fs::write(&opf_path, opf).map_err(io)?;

    Ok(opf_path)
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .user_agent(USER_AGENT)
        .build()
        .into()
}

/// The page's final URL, after redirects, and its HTML.
fn fetch_page(agent: &ureq::Agent, url: &str) -> Result<(String, String), ConvertError> {
    let mut response = agent
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml")
        .call()
        .map_err(fetch_error)?;
    let content_type = response.body().mime_type().unwrap_or("text/html").to_owned();
    if !content_type.contains("html") {
        return Err(ConvertError::Article(format!("the link is a {content_type} file, not a web page")));
    }
    let page_url = response.get_uri().to_string();
    let bytes = response.body_mut().with_config().limit(MAX_PAGE_BYTES).read_to_vec().map_err(fetch_error)?;
    Ok((page_url, String::from_utf8_lossy(&bytes).into_owned()))
}

/// No response at all is `Fetch`: the phone is offline, or the site is down. An answer that
/// is not a page is `Article`, which trying again will not fix.
fn fetch_error(error: ureq::Error) -> ConvertError {
    match error {
        ureq::Error::StatusCode(code) => ConvertError::Article(format!("the page answered {code}")),
        ureq::Error::BadUri(_) | ureq::Error::BodyExceedsLimit(_) => ConvertError::Article(error.to_string()),
        _ => ConvertError::Fetch(error.to_string()),
    }
}

#[derive(Clone)]
struct Jpeg {
    bytes: Vec<u8>,
    width: u32,
}

/// Any image format the `image` crate reads, as a JPEG no wider than the Kindle's screen.
/// A missing or unreadable image is left out of the book rather than failing it.
fn fetch_image(agent: &ureq::Agent, url: &str, min_width: u32) -> Option<Jpeg> {
    let bytes = agent.get(url).call().ok()?.body_mut().with_config().limit(MAX_IMAGE_BYTES).read_to_vec().ok()?;
    let image = image::load_from_memory(&bytes).ok()?;
    if image.width() < min_width.max(2) {
        return None;
    }
    let image = if image.width() > MAX_IMAGE_WIDTH { image.resize(MAX_IMAGE_WIDTH, u32::MAX, image::imageops::FilterType::Triangle) } else { image };
    let mut jpeg = Vec::new();
    image.to_rgb8().write_to(&mut Cursor::new(&mut jpeg), image::ImageFormat::Jpeg).ok()?;
    Some(Jpeg { bytes: jpeg, width: image.width() })
}

/// `src`, or the last (usually largest) `srcset` candidate for images that only have that.
fn image_source(src: Option<&str>, srcset: Option<&str>) -> Option<String> {
    let src = src.map(str::trim).filter(|s| s.starts_with("http"));
    let from_set = || srcset?.split(',').filter_map(|c| c.split_whitespace().next()).filter(|s| s.starts_with("http")).last();
    src.or_else(from_set).map(str::to_owned)
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}
