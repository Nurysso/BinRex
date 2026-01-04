use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Terminal,
};
use std::{
    collections::VecDeque,
    fs,
    io::{self, stdout},
    path::{Path, PathBuf},
    process::{Child, Command as ProcessCommand, Stdio},
};

mod ipc;
use ipc::{Command, Response as IpcResponse};

struct App {
    current_path: PathBuf,
    items: Vec<DirItem>,
    selected: usize,
    server_process: Option<Child>,
    server_connected: bool,
    server_url: String,
    server_port: u16,
    logs: VecDeque<String>,
}

struct DirItem {
    name: String,
    is_dir: bool,
    path: PathBuf,
}

impl App {
    fn new() -> io::Result<Self> {
        let current_path = std::env::current_dir()?;
        let items = Self::read_directory(&current_path)?;

        Ok(Self {
            current_path,
            items,
            selected: 0,
            server_process: None,
            server_connected: false,
            server_url: String::from("http://localhost:3000"),
            server_port: 3000,
            logs: VecDeque::new(),
        })
    }

    fn add_log(&mut self, message: String) {
        let timestamp = chrono::Local::now().format("%H:%M:%S");
        self.logs.push_front(format!("[{}] {}", timestamp, message));
        if self.logs.len() > 100 {
            self.logs.pop_back();
        }
    }

    fn read_directory(path: &Path) -> io::Result<Vec<DirItem>> {
        let mut items = vec![DirItem {
            name: "..".to_string(),
            is_dir: true,
            path: path.parent().unwrap_or(path).to_path_buf(),
        }];

        let entries = fs::read_dir(path)?;
        let mut dir_items: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let path = e.path();
                let name = e.file_name().to_string_lossy().to_string();
                let is_dir = path.is_dir();
                Some(DirItem { name, is_dir, path })
            })
            .collect();

        dir_items.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));

        items.extend(dir_items);
        Ok(items)
    }

    fn navigate_to(&mut self, path: PathBuf) -> io::Result<()> {
        if path.is_dir() {
            self.current_path = path;
            self.items = Self::read_directory(&self.current_path)?;
            self.selected = 0;
        }
        Ok(())
    }

    fn select_item(&mut self) -> io::Result<()> {
        if let Some(item) = self.items.get(self.selected) {
            if item.is_dir {
                self.navigate_to(item.path.clone())?;
            } else {
                // For files, just log that it's a file
                self.add_log(format!("Selected file: {}", item.name));
            }
        }
        Ok(())
    }

    fn move_up(&mut self) {
        if self.selected > 0 {
            self.selected -= 1;
        }
    }

    fn move_down(&mut self) {
        if self.selected < self.items.len().saturating_sub(1) {
            self.selected += 1;
        }
    }

    fn start_server(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.server_process.is_some() {
            self.add_log("Server already running".to_string());
            return Ok(());
        }

        self.add_log("Starting server...".to_string());

        // Get the current executable directory to find websii-server
        let exe_path = std::env::current_exe()?;
        let exe_dir = exe_path.parent().unwrap();
        let server_path = exe_dir.join("websii-server");

        let child = ProcessCommand::new(server_path)
            .arg("--port")
            .arg(self.server_port.to_string())
            .arg("--dir")
            .arg(&self.current_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;

        self.server_process = Some(child);
        self.add_log(format!("Server started on port {}", self.server_port));
        self.add_log(format!("URL: http://localhost:{}", self.server_port));

        // Give server time to start
        std::thread::sleep(std::time::Duration::from_secs(1));
        self.server_connected = true;

        Ok(())
    }

    fn stop_server(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(mut child) = self.server_process.take() {
            self.add_log("Stopping server...".to_string());
            child.kill()?;
            child.wait()?;
            self.server_connected = false;
            self.add_log("Server stopped".to_string());
        } else {
            self.add_log("No server running".to_string());
        }
        Ok(())
    }

    async fn send_directory_to_server(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let client = reqwest::Client::new();
        let url = format!("{}/__control__", self.server_url);

        let command = Command::SetDirectory {
            path: self.current_path.clone(),
        };

        let response: reqwest::Response = client
            .post(&url)
            .json(&command)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await?;

        let result: IpcResponse = response.json().await?;

        if result.success {
            self.server_connected = true;
            self.add_log(format!("✓ {}", result.message));
        } else {
            self.add_log(format!("✗ {}", result.message));
        }

        Ok(())
    }

    async fn send_file_to_server(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(item) = self.items.get(self.selected) {
            if !item.is_dir {
                let client = reqwest::Client::new();
                let url = format!("{}/__control__", self.server_url);

                let command = Command::SetFile {
                    path: item.path.clone(),
                };

                let response: reqwest::Response = client
                    .post(&url)
                    .json(&command)
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await?;

                let result: IpcResponse = response.json().await?;

                if result.success {
                    self.server_connected = true;
                    self.add_log(format!("✓ {}", result.message));
                    self.add_log("Access at: http://localhost:3000/".to_string());
                } else {
                    self.add_log(format!("✗ {}", result.message));
                }
            } else {
                self.add_log("✗ Please select a file, not a directory".to_string());
            }
        }

        Ok(())
    }

    async fn check_server_status(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let client = reqwest::Client::new();
        let url = format!("{}/__control__", self.server_url);

        let command = Command::GetStatus;

        let response: reqwest::Response = client
            .post(&url)
            .json(&command)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await?;

        let result: IpcResponse = response.json().await?;

        if result.success {
            self.server_connected = true;
            if let Some(path) = result.current_path {
                self.add_log(format!("Server serving: {}", path.display()));
            }
            if let Some(port) = result.port {
                self.server_port = port;
            }
        }

        Ok(())
    }
}

impl Drop for App {
    fn drop(&mut self) {
        if let Some(mut child) = self.server_process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn ui(f: &mut ratatui::Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0), Constraint::Length(5)])
        .split(f.size());

    // Header
    let header = Paragraph::new(vec![Line::from(vec![
        Span::styled(
            "Websii ",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("- File Manager with Integrated Server"),
    ])])
    .block(Block::default().borders(Borders::ALL));
    f.render_widget(header, chunks[0]);

    // Split middle section
    let middle_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(chunks[1]);

    // File list
    let items: Vec<ListItem> = app
        .items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let icon = if item.is_dir { "" } else { "" };
            let content = format!("{} {}", icon, item.name);

            let style = if i == app.selected {
                Style::default().bg(Color::DarkGray).fg(Color::White)
            } else if item.is_dir {
                Style::default().fg(Color::Blue)
            } else {
                Style::default()
            };

            ListItem::new(content).style(style)
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title(format!(" {}", app.current_path.display())),
    );
    f.render_widget(list, middle_chunks[0]);

    // Logs
    let log_items: Vec<Line> = app
        .logs
        .iter()
        .map(|log| {
            if log.contains("ERROR") || log.contains("✗") {
                Line::from(Span::styled(log.clone(), Style::default().fg(Color::Red)))
            } else if log.contains("✓") || log.contains("started") {
                Line::from(Span::styled(
                    log.clone(),
                    Style::default().fg(Color::Green),
                ))
            } else {
                Line::from(log.clone())
            }
        })
        .collect();

    let logs_widget = Paragraph::new(log_items)
        .block(Block::default().borders(Borders::ALL).title("Logs"))
        .wrap(Wrap { trim: true });
    f.render_widget(logs_widget, middle_chunks[1]);

    // Footer
    let server_status = if app.server_connected {
        format!("Server: http://localhost:{} ✓", app.server_port)
    } else {
        "Server: Not Running".to_string()
    };

    let selected_item = app.items.get(app.selected);
    let item_type = if let Some(item) = selected_item {
        if item.is_dir {
            " Dir"
        } else {
            " File"
        }
    } else {
        ""
    };

    let footer = Paragraph::new(vec![
        Line::from(vec![
            Span::raw("↑/↓: Navigate | Enter: Open | "),
            Span::styled("S", Style::default().fg(Color::Green)),
            Span::raw(": Start Server | "),
            Span::styled("X", Style::default().fg(Color::Red)),
            Span::raw(": Stop Server"),
        ]),
        Line::from(vec![
            Span::styled("P", Style::default().fg(Color::Yellow)),
            Span::raw(": Push Dir | "),
            Span::styled("F", Style::default().fg(Color::Magenta)),
            Span::raw(": Push File | "),
            Span::styled("C", Style::default().fg(Color::Cyan)),
            Span::raw(": Check | "),
            Span::styled("Q", Style::default().fg(Color::Red)),
            Span::raw(": Quit"),
        ]),
        Line::from(vec![
            Span::styled(&server_status, Style::default().fg(Color::Cyan)),
            Span::raw(" | "),
            Span::styled(item_type, Style::default().fg(Color::Yellow)),
        ]),
    ])
    .block(Block::default().borders(Borders::ALL));
    f.render_widget(footer, chunks[2]);
}

async fn run_app() -> io::Result<()> {
    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new()?;
    app.add_log("Websii File Manager started".to_string());
    app.add_log("Press 'S' to start the integrated server".to_string());
    app.add_log("Press 'P' to push current directory".to_string());
    app.add_log("Press 'F' to push selected file directly".to_string());

    let result: io::Result<()> = loop {
        terminal.draw(|f| ui(f, &app))?;

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Char('Q') => {
                            if let Err(e) = app.stop_server() {
                                app.add_log(format!("Error stopping server: {}", e));
                            }
                            break Ok(());
                        }
                        KeyCode::Up => app.move_up(),
                        KeyCode::Down => app.move_down(),
                        KeyCode::Enter => {
                            if let Err(e) = app.select_item() {
                                app.add_log(format!("ERROR: {}", e));
                            }
                        }
                        KeyCode::Char('s') | KeyCode::Char('S') => {
                            if let Err(e) = app.start_server() {
                                app.add_log(format!("✗ Failed to start server: {}", e));
                            }
                        }
                        KeyCode::Char('x') | KeyCode::Char('X') => {
                            if let Err(e) = app.stop_server() {
                                app.add_log(format!("✗ Failed to stop server: {}", e));
                            }
                        }
                        KeyCode::Char('p') | KeyCode::Char('P') => {
                            if !app.server_connected {
                                app.add_log("✗ Server not running! Press 'S' to start".to_string());
                            } else {
                                app.add_log("Pushing directory to server...".to_string());
                                if let Err(e) = app.send_directory_to_server().await {
                                    app.add_log(format!("✗ Failed to connect: {}", e));
                                    app.server_connected = false;
                                }
                            }
                        }
                        KeyCode::Char('f') | KeyCode::Char('F') => {
                            if !app.server_connected {
                                app.add_log("✗ Server not running! Press 'S' to start".to_string());
                            } else {
                                app.add_log("Pushing file to server...".to_string());
                                if let Err(e) = app.send_file_to_server().await {
                                    app.add_log(format!("✗ Failed to connect: {}", e));
                                    app.server_connected = false;
                                }
                            }
                        }
                        KeyCode::Char('c') | KeyCode::Char('C') => {
                            if let Err(e) = app.check_server_status().await {
                                app.add_log(format!("✗ Server not reachable: {}", e));
                                app.server_connected = false;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    };

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    result
}

#[tokio::main]
async fn main() -> io::Result<()> {
    run_app().await
}
