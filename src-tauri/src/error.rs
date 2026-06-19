use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("SSH error: {0}")]
    Ssh(#[from] russh::Error),

    #[error("SFTP error: {0}")]
    Sftp(#[from] russh_sftp::client::error::Error),

    #[error("Connection not found: {id}")]
    ConnectionNotFound { id: String },

    #[error("Terminal not found: {id}")]
    TerminalNotFound { id: String },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Config error: {0}")]
    Config(String),

    #[error("Auth failed: {0}")]
    AuthFailed(String),

    #[error("File too large: {size} bytes")]
    FileTooLarge { size: u64 },

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
