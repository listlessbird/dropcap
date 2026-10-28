//! EPUB -> Kindle conversion for the Android app, exported to TypeScript through uniffi.
//!
//! One call does what the stock-reader Kindle needs: a KF8 `.azw3` tagged EBOK with an ASIN
//! (EXTH 113 + 501, required for lock-screen covers) plus the exact thumbnail file the firmware
//! looks for, `thumbnail_<asin>_EBOK_portrait.jpg`. Upload the thumbnail before the book; the
//! Kindle installs it before indexing so the firmware never fetches Amazon's placeholder.
//! See docs/discoveries.md (Covers) and docs/android-app.md.

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
/// never on the JS thread.
#[uniffi::export]
pub async fn convert_epub(epub_path: String, out_dir: String) -> Result<Converted, ConvertError> {
    let (tx, rx) = futures_channel::oneshot::channel();
    std::thread::spawn(move || {
        let _ = tx.send(convert_blocking(&epub_path, &out_dir));
    });
    rx.await.map_err(|_| ConvertError::Io("conversion thread panicked".into()))?
}

fn convert_blocking(epub_path: &str, out_dir: &str) -> Result<Converted, ConvertError> {
    let (temp_dir, opf_path) = epub::extract_epub(Path::new(epub_path)).map_err(|e| ConvertError::Epub(e.to_string()))?;
    let result = build(&opf_path, Path::new(out_dir));
    epub::cleanup_temp_dir(&temp_dir);
    result
}

fn build(opf_path: &Path, out_dir: &Path) -> Result<Converted, ConvertError> {
    let extracted = ExtractedEpub::from_opf_path(opf_path).map_err(|e| ConvertError::Epub(e.to_string()))?;
    let (title, author) = (extracted.opf.title.clone(), extracted.opf.author.clone());

    std::fs::create_dir_all(out_dir).map_err(|e| ConvertError::Io(e.to_string()))?;
    let book_path = out_dir.join(format!("{}.azw3", file_stem(&title, &author)));

    // Same choices as `kindling-cli build --doc-type ebok --no-validate --no-hd-images --no-embed-source`.
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
    .map_err(|e| ConvertError::Build(e.to_string()))?;

    let thumb = mobi_rewrite::extract_device_thumbnail(&book_path).map_err(|e| ConvertError::Thumbnail(e.to_string()))?;
    let thumbnail_name = format!("thumbnail_{}_{}_portrait.jpg", thumb.asin, thumb.cde_type);
    let thumbnail_path = out_dir.join(&thumbnail_name);
    std::fs::write(&thumbnail_path, &thumb.image).map_err(|e| ConvertError::Io(e.to_string()))?;

    Ok(Converted {
        book_path: path_string(book_path),
        thumbnail_name,
        thumbnail_path: path_string(thumbnail_path),
        title,
        author,
    })
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

    #[test]
    fn file_stem_is_safe_and_readable() {
        assert_eq!(file_stem("Memories of Ice: Book 3", "Steven Erikson"), "Memories of Ice_ Book 3 - Steven Erikson");
        assert_eq!(file_stem("  ", ""), "untitled");
    }

    #[test]
    fn converts_a_real_epub() {
        let Ok(epub) = std::env::var("KINDLE_CORE_TEST_EPUB") else { return };
        let out = std::env::temp_dir().join(format!("kindle-core-test-{}", std::process::id()));
        let converted = pollster::block_on(convert_epub(epub, out.to_string_lossy().into())).expect("converts");
        assert!(converted.thumbnail_name.starts_with("thumbnail_") && converted.thumbnail_name.ends_with("_EBOK_portrait.jpg"));
        assert!(std::fs::metadata(&converted.book_path).unwrap().len() > 0);
        assert!(std::fs::read(&converted.thumbnail_path).unwrap().starts_with(&[0xFF, 0xD8]));
        std::fs::remove_dir_all(out).ok();
    }
}
