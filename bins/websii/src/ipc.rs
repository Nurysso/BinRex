use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Command {
    SetDirectory { path: PathBuf },
    SetFile { path: PathBuf },
    GetStatus,
    Stop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub success: bool,
    pub message: String,
    pub current_path: Option<PathBuf>,
    pub port: Option<u16>,
}

impl Response {
    pub fn success(message: String) -> Self {
        Self {
            success: true,
            message,
            current_path: None,
            port: None,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            message,
            current_path: None,
            port: None,
        }
    }

    pub fn status(message: String, current_path: PathBuf, port: u16) -> Self {
        Self {
            success: true,
            message,
            current_path: Some(current_path),
            port: Some(port),
        }
    }
}
