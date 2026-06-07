// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Holds the spawned Node engine so we can kill it on exit.
struct Engine(Mutex<Option<Child>>);

/// Find the engine entry (dist/cli.js): SENTINEL_ENGINE override, else walk up
/// from the current dir / executable looking for `dist/cli.js`.
fn find_engine() -> PathBuf {
    if let Ok(p) = std::env::var("SENTINEL_ENGINE") {
        return PathBuf::from(p);
    }
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(d) = std::env::current_dir() {
        starts.push(d);
    }
    if let Ok(e) = std::env::current_exe() {
        if let Some(p) = e.parent() {
            starts.push(p.to_path_buf());
        }
    }
    for start in starts {
        let mut cur = Some(start);
        while let Some(dir) = cur {
            let cand = dir.join("dist").join("cli.js");
            if cand.exists() {
                return cand;
            }
            cur = dir.parent().map(|p| p.to_path_buf());
        }
    }
    PathBuf::from("dist/cli.js")
}

/// Spawn `node dist/cli.js serve` and read the {port, token} handshake line.
fn start_engine() -> (u16, String, Child) {
    let engine = find_engine();
    let project = std::env::var("SENTINEL_PROJECT")
        .ok()
        .or_else(|| std::env::current_dir().ok().map(|d| d.to_string_lossy().to_string()))
        .unwrap_or_else(|| ".".into());

    let mut child = Command::new("node")
        .arg(&engine)
        .arg("serve")
        .arg("--project")
        .arg(&project)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to start the Sentinel engine — is Node on PATH and `dist/cli.js` built?");

    let stdout = child.stdout.take().expect("no engine stdout");
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader.read_line(&mut line).expect("failed to read engine handshake");
    let v: serde_json::Value = serde_json::from_str(line.trim()).expect("invalid handshake JSON");
    let port = v["port"].as_u64().expect("handshake missing port") as u16;
    let token = v["token"].as_str().expect("handshake missing token").to_string();

    // Drain the rest of stdout so the pipe never blocks the engine.
    std::thread::spawn(move || {
        for _ in reader.lines() {}
    });

    (port, token, child)
}

fn main() {
    let (port, token, child) = start_engine();
    // Injected before the page loads; the frontend reads these globals.
    let init = format!(
        "window.__SENTINEL_PORT__={};window.__SENTINEL_TOKEN__={:?};",
        port, token
    );

    tauri::Builder::default()
        .setup(move |app| {
            app.manage(Engine(Mutex::new(Some(child))));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Sentinel CLI")
                .inner_size(1320.0, 860.0)
                .min_inner_size(940.0, 620.0)
                .initialization_script(&init)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building Sentinel GUI")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(engine) = app.try_state::<Engine>() {
                    if let Some(mut c) = engine.0.lock().unwrap().take() {
                        let _ = c.kill();
                    }
                }
            }
        });
}
