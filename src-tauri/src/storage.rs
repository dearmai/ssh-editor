//! Portable builds keep both the profile store and WebView2 state beside the exe.
use std::path::PathBuf;

#[cfg(all(windows, feature = "portable"))]
fn data_dir() -> std::io::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    Ok(exe
        .parent()
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Executable directory not found",
            )
        })?
        .join("data"))
}

pub fn initialize() -> std::io::Result<()> {
    #[cfg(all(windows, feature = "portable"))]
    {
        let root = data_dir()?;
        std::fs::create_dir_all(&root)?;
        // Fail at startup if the portable directory is read-only; never fall back
        // to the user's AppData directory and silently split their settings.
        let probe = root.join(format!(".write-test-{}", uuid::Uuid::new_v4()));
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)?;
        std::fs::remove_file(probe)?;
        let webview = root.join("webview");
        std::fs::create_dir_all(&webview)?;
        // Set before Tauri creates any threads or webviews. This applies to the
        // initial window and every subsequently created window in this process.
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", webview);
        let runtime = root.parent().unwrap().join("WebView2");
        if runtime.join("msedgewebview2.exe").is_file() {
            std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", runtime);
        }
    }
    Ok(())
}

pub fn profiles_path() -> std::io::Result<PathBuf> {
    #[cfg(all(windows, feature = "portable"))]
    {
        return Ok(data_dir()?.join("ssh-editor.json"));
    }
    #[cfg(not(all(windows, feature = "portable")))]
    {
        Ok(PathBuf::from("ssh-editor.json"))
    }
}
