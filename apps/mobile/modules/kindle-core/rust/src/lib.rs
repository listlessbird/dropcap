//! EPUB -> Kindle conversion for the Android app, exported to TypeScript through uniffi.
//!
//! One call does what the stock-reader Kindle needs: a KF8 `.azw3` tagged EBOK with an ASIN
//! (EXTH 113 + 501, required for lock-screen covers) plus the exact thumbnail file the firmware
//! looks for, `thumbnail_<asin>_EBOK_portrait.jpg`. Upload the thumbnail before the book; the
//! Kindle installs it before indexing so the firmware never fetches Amazon's placeholder.
//! See docs/discoveries.md (Covers) and docs/android-app.md in ~/projects/kindle.

use std::any::Any;
use std::fmt::Display;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use kindling::{epub, extracted::ExtractedEpub, mobi, mobi_rewrite};

uniffi::setup_scaffolding!();

#[derive(Debug, uniffi::Record)]
pub struct Converted {
    /// `<out_dir>/<Title - Author>.azw3`
    pub book_path: String,
    /// The firmware's file name for this book's cover: `thumbnail_<asin>_EBOK_portrait.jpg`.
    pub thumbnail_name: String,
    pub thumbnail_path: String,
    pub title: String,
    pub author: String,
}

#[derive(Debug, uniffi::Record)]
pub struct Thumbnail {
    /// `thumbnail_<asin>_<cde_type>_portrait.jpg`, the name the firmware looks for.
    pub name: String,
    pub path: String,
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum ConvertError {
    #[error("could not read the EPUB: {0}")]
    Epub(String),
    #[error("could not build the book: {0}")]
    Build(String),
    #[error("could not extract the cover thumbnail: {0}")]
    Thumbnail(String),
    #[error("i/o error: {0}")]
    Io(String),
}

/// Convert `epub_path` into an EBOK AZW3 and its device thumbnail, both written to `out_dir`.
/// A Promise in TypeScript: the CPU-bound work (seconds for a large book) runs on its own thread,
/// never on the JS thread. Aborting the Promise stops the work at the next stage boundary and
/// removes what it wrote; kindling's build itself cannot be interrupted.
#[uniffi::export]
pub async fn convert_epub(epub_path: String, out_dir: String) -> Result<Converted, ConvertError> {
    off_thread(move |cancelled| convert(Path::new(&epub_path), Path::new(&out_dir), cancelled)).await
}

/// Write the device thumbnail of an existing AZW3 (one with EXTH 113 + 501, as EBOK books have)
/// into `out_dir`, named the way the firmware expects.
#[uniffi::export]
pub async fn device_thumbnail(azw3_path: String, out_dir: String) -> Result<Thumbnail, ConvertError> {
    off_thread(move |_| Ok(write_thumbnail(Path::new(&azw3_path), Path::new(&out_dir))?)).await
}

/// Why a conversion ended without a book. `Cancelled` never reaches TypeScript: by the time the
/// work notices, nobody is waiting for the result.
#[derive(Debug)]
enum Stop {
    Cancelled,
    Failed(ConvertError),
}

impl From<ConvertError> for Stop {
    fn from(error: ConvertError) -> Self {
        Stop::Failed(error)
    }
}

/// Runs `work` on its own thread. Aborting the Promise makes uniffi drop this future, which
/// drops the receiver; `work` sees that through the `cancelled` check it is handed.
async fn off_thread<T: Send + 'static>(
    work: impl FnOnce(&dyn Fn() -> bool) -> Result<T, Stop> + Send + 'static,
) -> Result<T, ConvertError> {
    let (tx, rx) = futures_channel::oneshot::channel::<Result<T, ConvertError>>();
    std::thread::Builder::new()
        .name("kindle-core".into())
        .spawn(move || {
            let result = work(&|| tx.is_canceled());
            let _ = match result {
                Ok(value) => tx.send(Ok(value)),
                Err(Stop::Failed(error)) => tx.send(Err(error)),
                Err(Stop::Cancelled) => Ok(()),
            };
        })
        .map_err(io)?;
    rx.await.unwrap_or_else(|_| Err(ConvertError::Io("the conversion stopped without a result".into())))
}

fn convert(epub_path: &Path, out_dir: &Path, cancelled: &dyn Fn() -> bool) -> Result<Converted, Stop> {
    checkpoint(cancelled)?;
    let (temp_dir, opf_path) = kindling(ConvertError::Epub, || epub::extract_epub(epub_path))?;
    let result = build(&opf_path, out_dir, cancelled);
    epub::cleanup_temp_dir(&temp_dir);
    result
}

fn build(opf_path: &Path, out_dir: &Path, cancelled: &dyn Fn() -> bool) -> Result<Converted, Stop> {
    let extracted = kindling(ConvertError::Epub, || ExtractedEpub::from_opf_path(opf_path))?;
    let (title, author) = (extracted.opf.title.clone(), extracted.opf.author.clone());
    checkpoint(cancelled)?;

    std::fs::create_dir_all(out_dir).map_err(io)?;
    let book_path = out_dir.join(format!("{}.azw3", file_stem(&title, &author)));

    // Same choices as `kindling-cli build --doc-type ebok --no-validate --no-hd-images --no-embed-source`.
    // Most of a conversion is spent in here, with no way to stop it early.
    kindling(ConvertError::Build, || {
        mobi::build_mobi_from_extracted(
            &extracted,
            &book_path,
            false,        // no_compress
            false,        // headwords_only
            None,         // srcs_data: don't embed the source EPUB (it doubles the size)
            false,        // include_cmet
            true,         // no_hd_images: the PW3 screen doesn't need the HD container
            false,        // creator_tag
            true,         // kf8_only: .azw3
            Some("EBOK"), // doc_type: EBOK + EXTH 113 is what gives a lock-screen cover
            true,         // kindle_limits (CLI default; books only warn)
            true,         // self_check: post-build readback
            false,        // kindlegen_parity (comics only)
            false,        // strict_accents
            false,        // fold_accents
            false,        // force_user_fonts
        )
    })?;

    // A failed or cancelled conversion leaves nothing in `out_dir` for the app to clean up.
    let thumb = checkpoint(cancelled).and_then(|()| Ok(write_thumbnail(&book_path, out_dir)?));
    let thumb = thumb.and_then(|thumb| match checkpoint(cancelled) {
        Ok(()) => Ok(thumb),
        Err(stop) => {
            let _ = std::fs::remove_file(&thumb.path);
            Err(stop)
        }
    });
    let thumb = thumb.inspect_err(|_| {
        let _ = std::fs::remove_file(&book_path);
    })?;

    Ok(Converted {
        book_path: path_string(book_path),
        thumbnail_name: thumb.name,
        thumbnail_path: thumb.path,
        title,
        author,
    })
}

fn write_thumbnail(book_path: &Path, out_dir: &Path) -> Result<Thumbnail, ConvertError> {
    let thumb = kindling(ConvertError::Thumbnail, || mobi_rewrite::extract_device_thumbnail(book_path))?;
    let name = format!("thumbnail_{}_{}_portrait.jpg", thumb.asin, thumb.cde_type);
    let path = out_dir.join(&name);
    std::fs::create_dir_all(out_dir).map_err(io)?;
    std::fs::write(&path, &thumb.image).map_err(io)?;
    Ok(Thumbnail { name, path: path_string(path) })
}

fn checkpoint(cancelled: &dyn Fn() -> bool) -> Result<(), Stop> {
    if cancelled() { Err(Stop::Cancelled) } else { Ok(()) }
}

/// Calls into kindling, turning its errors and panics into `stage`, so a malformed book is an
/// error in the app rather than a crash. Stack overflows and aborts cannot be caught this way.
fn kindling<T, E: Display>(
    stage: fn(String) -> ConvertError,
    call: impl FnOnce() -> Result<T, E>,
) -> Result<T, ConvertError> {
    match panic::catch_unwind(AssertUnwindSafe(call)) {
        Ok(result) => result.map_err(|error| stage(error.to_string())),
        Err(payload) => Err(stage(format!("kindling crashed: {}", panic_message(payload.as_ref())))),
    }
}

fn panic_message(payload: &(dyn Any + Send)) -> &str {
    payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("unknown panic")
}

fn io(error: std::io::Error) -> ConvertError {
    ConvertError::Io(error.to_string())
}

/// "Title - Author", minus characters that are awkward in file names or the mailbox protocol.
fn file_stem(title: &str, author: &str) -> String {
    let raw = if author.is_empty() { title.to_owned() } else { format!("{title} - {author}") };
    let cleaned: String = raw.chars().map(|c| if r#"/\:*?"<>|"#.contains(c) || c.is_control() { '_' } else { c }).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() { "untitled".into() } else { trimmed.chars().take(120).collect() }
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A fresh directory per test, removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("kindle-core-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }

        fn files(&self, dir: &str) -> Vec<String> {
            let Ok(entries) = std::fs::read_dir(self.0.join(dir)) else { return vec![] };
            entries.map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Writes a one-chapter EPUB with a cover into `dir/source/book.epub`.
    fn fixture_epub(dir: &Path) -> PathBuf {
        let mut cover = Vec::new();
        image::RgbImage::from_pixel(60, 90, image::Rgb([200, 30, 30]))
            .write_to(&mut std::io::Cursor::new(&mut cover), image::ImageFormat::Jpeg)
            .unwrap();
        let files: [(&str, &[u8]); 5] = [
            ("mimetype", b"application/epub+zip"),
            (
                "META-INF/container.xml",
                br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#,
            ),
            (
                "OEBPS/content.opf",
                br#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture</dc:title><dc:creator>Tester</dc:creator><dc:identifier id="id">urn:uuid:fixture</dc:identifier><dc:language>en</dc:language><meta name="cover" content="cover"/></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="ch1"/></spine></package>"#,
            ),
            (
                "OEBPS/ch1.xhtml",
                br#"<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>Hello.</p></body></html>"#,
            ),
            ("OEBPS/cover.jpg", &cover),
        ];
        let path = dir.join("source").join("book.epub");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for (name, bytes) in files {
            zip.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    #[test]
    fn file_stem_is_safe_and_readable() {
        assert_eq!(file_stem("Memories of Ice: Book 3", "Steven Erikson"), "Memories of Ice_ Book 3 - Steven Erikson");
        assert_eq!(file_stem("  ", ""), "untitled");
    }

    #[test]
    fn converts_an_epub_into_a_book_and_its_thumbnail() {
        let dir = Scratch::new("convert");
        let epub = fixture_epub(&dir.0);
        let out = dir.0.join("out");
        let converted = pollster::block_on(convert_epub(path_string(epub), path_string(out))).unwrap();
        assert_eq!((converted.title.as_str(), converted.author.as_str()), ("Fixture", "Tester"));
        assert!(converted.book_path.ends_with("/Fixture - Tester.azw3"));
        assert!(converted.thumbnail_name.starts_with("thumbnail_") && converted.thumbnail_name.ends_with("_EBOK_portrait.jpg"));
        assert!(std::fs::read(&converted.thumbnail_path).unwrap().starts_with(&[0xFF, 0xD8]));
        assert_eq!(dir.files("source"), ["book.epub"], "kindling's extraction is cleaned up");
    }

    #[test]
    fn a_cancelled_conversion_never_starts() {
        let dir = Scratch::new("cancel-early");
        let epub = fixture_epub(&dir.0);
        let result = convert(&epub, &dir.0.join("out"), &|| true);
        assert!(matches!(result, Err(Stop::Cancelled)));
        assert_eq!(dir.files("source"), ["book.epub"]);
        assert!(dir.files("out").is_empty());
    }

    #[test]
    fn a_cancel_during_the_build_leaves_nothing_behind() {
        let dir = Scratch::new("cancel-late");
        let epub = fixture_epub(&dir.0);
        let out = dir.0.join("out");
        // Cancelled once the book exists, as when the user gives up while kindling builds.
        let book_written = || std::fs::read_dir(&out).is_ok_and(|mut entries| entries.next().is_some());
        let result = convert(&epub, &out, &book_written);
        assert!(matches!(result, Err(Stop::Cancelled)));
        assert!(dir.files("out").is_empty());
        assert_eq!(dir.files("source"), ["book.epub"]);
    }

    #[test]
    fn dropping_the_future_cancels_the_work() {
        use std::sync::mpsc;
        let (seen_tx, seen) = mpsc::channel();
        let (resume, paused) = mpsc::channel::<()>();
        let mut future = Box::pin(off_thread(move |cancelled| {
            seen_tx.send(cancelled()).unwrap();
            paused.recv().unwrap();
            seen_tx.send(cancelled()).unwrap();
            Err::<(), _>(Stop::Cancelled)
        }));
        // The first poll starts the thread, as uniffi does when JS calls the function.
        let pending = future.as_mut().poll(&mut std::task::Context::from_waker(std::task::Waker::noop()));
        assert!(pending.is_pending());
        assert_eq!(seen.recv(), Ok(false));
        // An aborted Promise makes uniffi free, and so drop, the future.
        drop(future);
        resume.send(()).unwrap();
        assert_eq!(seen.recv(), Ok(true));
    }

    #[test]
    fn a_broken_epub_is_an_error() {
        let dir = Scratch::new("broken");
        let epub = dir.0.join("broken.epub");
        std::fs::write(&epub, b"PK\x03\x04 this is not really a zip").unwrap();
        let result = pollster::block_on(convert_epub(path_string(epub), path_string(dir.0.join("out"))));
        assert!(matches!(result, Err(ConvertError::Epub(_))), "{result:?}");
        assert!(dir.files("out").is_empty());
    }

    #[test]
    fn a_panic_in_kindling_is_an_error() {
        let result = kindling(ConvertError::Build, || -> Result<(), String> { panic!("index out of bounds") });
        assert!(matches!(result, Err(ConvertError::Build(message)) if message == "kindling crashed: index out of bounds"));
    }

    #[test]
    fn extracts_the_device_thumbnail_of_an_azw3() {
        let dir = Scratch::new("thumbnail");
        let epub = fixture_epub(&dir.0);
        let converted = pollster::block_on(convert_epub(path_string(epub), path_string(dir.0.join("book")))).unwrap();
        let thumb = pollster::block_on(device_thumbnail(converted.book_path, path_string(dir.0.join("thumbs")))).unwrap();
        assert_eq!(thumb.name, converted.thumbnail_name);
        assert_eq!(std::fs::read(thumb.path).unwrap(), std::fs::read(converted.thumbnail_path).unwrap());
    }

    #[test]
    fn a_file_that_is_not_an_azw3_has_no_thumbnail() {
        let dir = Scratch::new("not-azw3");
        let file = dir.0.join("notes.azw3");
        std::fs::write(&file, b"just some text").unwrap();
        let result = pollster::block_on(device_thumbnail(path_string(file), path_string(dir.0.join("thumbs"))));
        assert!(matches!(result, Err(ConvertError::Thumbnail(_))), "{result:?}");
    }
}
