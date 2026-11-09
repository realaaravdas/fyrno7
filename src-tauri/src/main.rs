#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod acronyms;
mod analysis;
mod llm;
mod prompts;
mod textutil;
mod types;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use types::*;

#[derive(Default)]
struct AppState {
    cancel: Arc<AtomicBool>,
    /// (path, extracted page texts) of the paper that is currently open.
    cache: Mutex<Option<(String, Vec<String>)>>,
}

async fn pages_for(state: &AppState, path: &str) -> Result<Vec<String>, String> {
    if let Some((p, pages)) = state.cache.lock().unwrap().as_ref() {
        if p == path {
            return Ok(pages.clone());
        }
    }
    let owned = path.to_string();
    let pages = tauri::async_runtime::spawn_blocking(move || analysis::extract_pages(&owned))
        .await
        .map_err(|e| e.to_string())??;
    *state.cache.lock().unwrap() = Some((path.to_string(), pages.clone()));
    Ok(pages)
}

#[tauri::command]
async fn check_connection(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let s = Settings {
        base_url,
        api_key,
        model: String::new(),
        temperature: 0.0,
        chunk_chars: 0,
        max_tokens: 0,
    };
    llm::Client::new(&s).list_models().await
}

#[tauri::command]
fn read_pdf(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Cannot open {path}: {e}"))
}

#[tauri::command]
async fn inspect_pdf(state: State<'_, AppState>, path: String) -> Result<PaperInfo, String> {
    let pages = pages_for(&state, &path).await?;
    let chars: usize = pages.iter().map(|p| p.trim().len()).sum();
    Ok(PaperInfo {
        title: analysis::guess_title(&pages),
        n_pages: pages.len() as u32,
        chars,
        has_text: chars > 200,
    })
}

#[tauri::command]
async fn analyze(
    app: AppHandle,
    state: State<'_, AppState>,
    req: AnalyzeRequest,
) -> Result<AnalysisResult, String> {
    state.cancel.store(false, Ordering::SeqCst);
    let pages = pages_for(&state, &req.path).await?;
    if pages.iter().map(|p| p.trim().len()).sum::<usize>() < 200 {
        return Err("This PDF has no selectable text (it is probably a scan). Run OCR on it first.".into());
    }
    let cb = move |p: Progress| {
        let _ = app.emit("progress", p);
    };
    analysis::run(&cb, req, pages, state.cancel.clone()).await
}

#[tauri::command]
fn cancel_analysis(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Cannot write {path}: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            check_connection,
            read_pdf,
            inspect_pdf,
            analyze,
            cancel_analysis,
            save_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running neuron7");
}
