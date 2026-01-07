use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, StatusCode, Uri},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response as AxumResponse, sse::Event, Sse, Json},
    routing::{get, post},
    Router,
};
use futures::stream::{self, Stream};
use mime_guess::mime;
use notify::{RecursiveMode, Watcher};
use std::{
    convert::Infallible,
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use tokio::{
    fs,
    net::TcpListener,
    sync::{broadcast, RwLock},
};
use ipc::{Command, Response as IpcResponse};

mod ipc;

#[derive(Clone)]
struct ServerState {
    base_path: Arc<RwLock<PathBuf>>,
    direct_file: Arc<RwLock<Option<PathBuf>>>,
    reload_tx: broadcast::Sender<()>,
    port: u16,
}

// Control endpoint to change directory
async fn control_handler(
    State(state): State<ServerState>,
    Json(command): Json<Command>,
) -> Json<IpcResponse> {
    match command {
        Command::SetDirectory { path } => {
            if !path.exists() {
                return Json(IpcResponse::error(format!("Path does not exist: {:?}", path)));
            }
            if !path.is_dir() {
                return Json(IpcResponse::error(format!("Path is not a directory: {:?}", path)));
            }

            let canonical = match path.canonicalize() {
                Ok(p) => p,
                Err(e) => return Json(IpcResponse::error(format!("Cannot canonicalize path: {}", e))),
            };

            *state.base_path.write().await = canonical.clone();
            *state.direct_file.write().await = None;
            println!(" Directory changed to: {}", canonical.display());

            // Trigger reload for all connected clients
            let _ = state.reload_tx.send(());

            Json(IpcResponse::success(format!(
                "Directory set to: {}",
                canonical.display()
            )))
        }
        Command::SetFile { path } => {
            if !path.exists() {
                return Json(IpcResponse::error(format!("File does not exist: {:?}", path)));
            }
            if !path.is_file() {
                return Json(IpcResponse::error(format!("Path is not a file: {:?}", path)));
            }

            let canonical = match path.canonicalize() {
                Ok(p) => p,
                Err(e) => return Json(IpcResponse::error(format!("Cannot canonicalize path: {}", e))),
            };

            // Set the parent directory as base_path and the file as direct_file
            if let Some(parent) = canonical.parent() {
                *state.base_path.write().await = parent.to_path_buf();
                *state.direct_file.write().await = Some(canonical.clone());
                println!(" Direct file mode: {}", canonical.display());
                println!(" Base directory: {}", parent.display());

                // Trigger reload
                let _ = state.reload_tx.send(());

                Json(IpcResponse::success(format!(
                    "Direct file set to: {}",
                    canonical.display()
                )))
            } else {
                Json(IpcResponse::error("Cannot determine parent directory".to_string()))
            }
        }
        Command::GetStatus => {
            let path = state.base_path.read().await.clone();
            Json(IpcResponse::status(
                "Server running".to_string(),
                path,
                state.port,
            ))
        }
        Command::Stop => {
            println!("Stop command received - shutting down gracefully");
            std::thread::sleep(Duration::from_secs(2));
            std::process::exit(0);
        }
    }
}

// SSE endpoint for live reload
async fn sse_handler(
    State(state): State<ServerState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.reload_tx.subscribe();

    let stream = stream::unfold(rx, |mut rx| async move {
        rx.recv().await.ok()?;
        Some((Ok(Event::default().data("reload")), rx))
    });

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// Middleware to log requests
async fn log_requests(req: Request<Body>, next: Next) -> AxumResponse {
    let method = req.method().clone();
    let uri = req.uri().clone();

    let response = next.run(req).await;
    let status = response.status();

    println!("{} {} - {}", method, uri, status);

    response
}

async fn serve_file_or_directory(
    State(state): State<ServerState>,
    uri: Uri,
) -> Result<AxumResponse, StatusCode> {
    // Check if we're in direct file mode
    if let Some(direct_file) = state.direct_file.read().await.as_ref() {
        // In direct file mode, root URL serves the file directly
        if uri.path() == "/" {
            let contents = fs::read(direct_file)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let mime_type = mime_guess::from_path(direct_file).first_or_octet_stream();

            // Inject live reload script for HTML files
            if mime_type.type_() == mime::TEXT && mime_type.subtype() == mime::HTML {
                let html = String::from_utf8_lossy(&contents);
                let injected = inject_reload_script(&html);
                return Ok(AxumResponse::builder()
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Body::from(injected))
                    .unwrap());
            } else {
                return Ok(AxumResponse::builder()
                    .header(header::CONTENT_TYPE, mime_type.as_ref())
                    .body(Body::from(contents))
                    .unwrap());
            }
        }
        // For non-root paths in direct file mode, serve from base directory
    }

    let base_path = state.base_path.read().await.clone();
    let path_str = uri.path().trim_start_matches('/');
    let full_path = base_path.join(path_str);

    // Security check
    let canonical_base = base_path
        .canonicalize()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let canonical_full = match full_path.canonicalize() {
        Ok(p) => p,
        Err(_) => return Err(StatusCode::NOT_FOUND),
    };

    if !canonical_full.starts_with(&canonical_base) {
        return Err(StatusCode::FORBIDDEN);
    }

    if canonical_full.is_file() {
        // Serve file
        let contents = fs::read(&canonical_full)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let mime_type = mime_guess::from_path(&canonical_full).first_or_octet_stream();

        // Inject live reload script for HTML files
        if mime_type.type_() == mime::TEXT && mime_type.subtype() == mime::HTML {
            let html = String::from_utf8_lossy(&contents);
            let injected = inject_reload_script(&html);
            Ok(AxumResponse::builder()
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .body(Body::from(injected))
                .unwrap())
        } else {
            Ok(AxumResponse::builder()
                .header(header::CONTENT_TYPE, mime_type.as_ref())
                .body(Body::from(contents))
                .unwrap())
        }
    } else if canonical_full.is_dir() {
        // Check for index.html
        let index_path = canonical_full.join("index.html");
        if index_path.exists() && index_path.is_file() {
            let contents = fs::read(&index_path)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let html = String::from_utf8_lossy(&contents);
            let injected = inject_reload_script(&html);
            return Ok(AxumResponse::builder()
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .body(Body::from(injected))
                .unwrap());
        }

        // Generate directory listing
        let mut entries = fs::read_dir(&canonical_full)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let mut dirs = Vec::new();
        let mut files = Vec::new();

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let file_type = entry
                .file_type()
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let relative_path = if path_str.is_empty() {
                file_name.clone()
            } else {
                format!("{}/{}", path_str, file_name)
            };

            if file_type.is_dir() {
                dirs.push((file_name, relative_path));
            } else {
                files.push((file_name, relative_path));
            }
        }

        dirs.sort();
        files.sort();

        let mut html = String::from(
            "<!DOCTYPE html><html><head><meta charset='utf-8'>\
            <title>Directory listing</title>\
            <style>\
                body { font-family: monospace; max-width: 900px; margin: 40px auto; padding: 0 20px; }\
                h1 { color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }\
                ul { list-style: none; padding: 0; }\
                li { padding: 8px; border-bottom: 1px solid #eee; }\
                li:hover { background: #f5f5f5; }\
                a { text-decoration: none; color: #0066cc; }\
                a:hover { text-decoration: underline; }\
                .dir { font-weight: bold; }\
                .dir:before { content: ' '; }\
                .file:before { content: ' '; }\
            </style></head><body>",
        );

        html.push_str(&format!("<h1>Index of /{}</h1><ul>", path_str));

        if !path_str.is_empty() {
            let parent = if let Some(pos) = path_str.rfind('/') {
                &path_str[..pos]
            } else {
                ""
            };
            html.push_str(&format!("<li><a href='/{}'class='dir'>../</a></li>", parent));
        }

        for (name, path) in dirs {
            html.push_str(&format!(
                "<li><a href='/{}'class='dir'>{}/</a></li>",
                path, name
            ));
        }

        for (name, path) in files {
            html.push_str(&format!(
                "<li><a href='/{}'class='file'>{}</a></li>",
                path, name
            ));
        }

        html.push_str("</ul>");
        html.push_str(&get_reload_script());
        html.push_str("</body></html>");

        Ok(Html(html).into_response())
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

fn inject_reload_script(html: &str) -> String {
    if let Some(pos) = html.rfind("</body>") {
        let mut result = html[..pos].to_string();
        result.push_str(&get_reload_script());
        result.push_str(&html[pos..]);
        result
    } else {
        format!("{}{}", html, get_reload_script())
    }
}

fn get_reload_script() -> String {
    r#"
<script>
(function() {
    const evtSource = new EventSource('/__reload__');
    evtSource.onmessage = function(event) {
        if (event.data === 'reload') {
            console.log('File change detected, reloading...');
            window.location.reload();
        }
    };
    evtSource.onerror = function(err) {
        console.error('EventSource error:', err);
        evtSource.close();
        setTimeout(() => window.location.reload(), 5000);
    };
})();
</script>
"#
    .to_string()
}

pub async fn run_server(port: u16, initial_dir: PathBuf) -> std::io::Result<()> {
    let initial_dir = initial_dir.canonicalize()?;

    println!("Websii Server v0.2.1");
    println!("Serving directory: {}", initial_dir.display());
    println!("Server: http://localhost:{}", port);
    println!("Control API: http://localhost:{}/__control__", port);
    println!("Live reload enabled");
    println!();

    let (reload_tx, _) = broadcast::channel::<()>(100);

    let state = ServerState {
        base_path: Arc::new(RwLock::new(initial_dir.clone())),
        direct_file: Arc::new(RwLock::new(None)),
        reload_tx: reload_tx.clone(),
        port,
    };

    // Set up file watcher
    let watch_path = Arc::clone(&state.base_path);
    let watcher_tx = reload_tx.clone();

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::channel(100);

        let mut watcher = match notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.blocking_send(event);
                }
            },
        ) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[!] Failed to create file watcher: {}", e);
                return;
            }
        };

        loop {
            let current_path = watch_path.read().await.clone();

            if let Err(e) = watcher.watch(&current_path, RecursiveMode::Recursive) {
                eprintln!("[!] Failed to watch directory: {}", e);
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }

            println!("Watching: {}", current_path.display());

            while let Some(event) = rx.recv().await {
                use notify::EventKind;
                match event.kind {
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                        if let Some(path) = event.paths.first() {
                            println!("File changed: {}", path.display());
                        }
                        let _ = watcher_tx.send(());
                    }
                    _ => {}
                }
            }
        }
    });

    let app = Router::new()
        .route("/__control__", post(control_handler))
        .route("/__reload__", get(sse_handler))
        .fallback(serve_file_or_directory)
        .layer(middleware::from_fn(log_requests))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;

    println!("󰃏 Server ready!\n");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().collect();

    let port = if args.len() > 2 && args[1] == "--port" {
        args[2].parse().unwrap_or(3000)
    } else {
        3000
    };

    let initial_dir = if args.len() > 4 && args[3] == "--dir" {
        PathBuf::from(&args[4])
    } else {
        std::env::current_dir()?
    };

    run_server(port, initial_dir).await
}
