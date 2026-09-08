use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat};
use serde::Serialize;
use std::{
    fs::File,
    io::{Cursor, Read},
    path::Path,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardUpload {
    name: String,
    size: u64,
    local_path: Option<String>,
    data_base64: Option<String>,
    thumbnail: Option<String>,
    text_preview: Option<String>,
}

fn png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(output.into_inner())
}

fn thumbnail(image: &DynamicImage) -> Option<String> {
    png(&image.thumbnail(1440, 1080))
        .ok()
        .map(|data| format!("data:image/png;base64,{}", STANDARD.encode(data)))
}

fn local_file(path: &Path) -> Result<ClipboardUpload, String> {
    let metadata = path
        .metadata()
        .map_err(|e| format!("{}: {e}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("파일만 붙여넣을 수 있습니다: {}", path.display()));
    }
    let name = path
        .file_name()
        .ok_or("파일 이름이 없습니다")?
        .to_string_lossy()
        .into_owned();
    let mut item = ClipboardUpload {
        name,
        size: metadata.len(),
        local_path: Some(path.to_string_lossy().into_owned()),
        data_base64: None,
        thumbnail: None,
        text_preview: None,
    };
    // 미리보기가 실패해도 원본 파일 업로드는 가능하다. 큰 파일을 통째로 읽지 않는다.
    if metadata.len() <= 20 * 1024 * 1024 {
        if let Ok(reader) = image::ImageReader::open(path) {
            if let Ok(mut reader) = reader.with_guessed_format() {
                let mut limits = image::Limits::default();
                limits.max_alloc = Some(128 * 1024 * 1024);
                reader.limits(limits);
                if let Ok(image) = reader.decode() {
                    item.thumbnail = thumbnail(&image);
                }
            }
        }
    }
    if item.thumbnail.is_none() {
        let mut bytes = Vec::new();
        if let Ok(file) = File::open(path) {
            if file.take(8192).read_to_end(&mut bytes).is_ok() {
                let text = String::from_utf8_lossy(&bytes);
                if !text
                    .chars()
                    .any(|c| c == '\u{fffd}' || (c.is_control() && !"\n\r\t".contains(c)))
                {
                    item.text_preview = Some(text.into_owned());
                }
            }
        }
    }
    Ok(item)
}

/// Finder/Explorer 파일 목록을 이미지보다 우선한다 (파일의 원래 이름·형식 보존).
#[tauri::command]
pub async fn read_clipboard_uploads() -> Result<Vec<ClipboardUpload>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        match clipboard.get().file_list() {
            Ok(paths) if !paths.is_empty() => return paths.iter().map(|p| local_file(p)).collect(),
            Err(arboard::Error::ContentNotAvailable) | Ok(_) => {}
            Err(e) => return Err(e.to_string()),
        }
        let image = match clipboard.get_image() {
            Ok(image) => image,
            Err(arboard::Error::ContentNotAvailable) => return Ok(Vec::new()),
            Err(e) => return Err(e.to_string()),
        };
        let rgba = image::RgbaImage::from_raw(
            image.width as u32,
            image.height as u32,
            image.bytes.into_owned(),
        )
        .ok_or("클립보드 이미지 형식이 올바르지 않습니다")?;
        let image = DynamicImage::ImageRgba8(rgba);
        let data = png(&image)?;
        Ok(vec![ClipboardUpload {
            name: format!("clipboard-{}.png", uuid::Uuid::new_v4()),
            size: data.len() as u64,
            local_path: None,
            data_base64: Some(STANDARD.encode(data)),
            thumbnail: thumbnail(&image),
            text_preview: None,
        }])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_text_image_and_binary_without_modifying_files() {
        let dir = std::env::temp_dir().join(format!("ssh-editor-preview-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let text = dir.join("hello.txt");
        std::fs::write(&text, "미리보기 <script>alert(1)</script>").unwrap();
        assert!(local_file(&text)
            .unwrap()
            .text_preview
            .unwrap()
            .starts_with("미리보기"));
        let binary = dir.join("data.bin");
        std::fs::write(&binary, [0, 255, 1]).unwrap();
        assert!(local_file(&binary).unwrap().text_preview.is_none());
        let image = dir.join("sample.png");
        DynamicImage::new_rgba8(640, 400).save(&image).unwrap();
        assert!(local_file(&image)
            .unwrap()
            .thumbnail
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(local_file(&dir).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
