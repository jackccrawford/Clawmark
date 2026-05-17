// Geniuz dashboard — Tauri commands.
//
// All data access goes through the canonical geniuz library
// (`geniuz::db::DatabaseManager`). The dashboard does NOT open memory.db
// directly or maintain its own data layer. One source of truth for schema
// and query logic, used by the CLI, the MCP server, and this dashboard alike.

use geniuz::db::{DatabaseManager, SignalEntry};
use serde::Serialize;

fn db_path() -> String {
    geniuz::data_dir()
        .join("memory.db")
        .to_string_lossy()
        .into_owned()
}

fn open_db() -> Result<DatabaseManager, String> {
    DatabaseManager::new(&db_path())
}

#[derive(Serialize, Default)]
struct StationStats {
    total_memories: usize,
    this_week: usize,
    conversations: usize,
    storage_bytes: u64,
    daily_average_recent: f64,
    last_write_iso: Option<String>,
}

#[derive(Serialize)]
struct RecentMemory {
    uuid: String,
    gist: String,
    content: Option<String>,
    created_at: String,
    category: Option<String>,
    parent_uuid: Option<String>,
}

#[derive(Serialize)]
struct DailyCount {
    date: String,
    count: usize,
}

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn get_station_stats() -> Result<StationStats, String> {
    let db = open_db()?;
    let total_memories = db.count()?;
    let this_week = db.count_since_days(7)?;
    let conversations = db.thread_count()?;
    let recent_30 = db.count_since_days(30)?;
    let daily_average_recent = (recent_30 as f64) / 30.0;
    let last_write_iso = db.last_write_timestamp()?;
    let storage_bytes = std::fs::metadata(db_path()).map(|m| m.len()).unwrap_or(0);

    Ok(StationStats {
        total_memories,
        this_week,
        conversations,
        storage_bytes,
        daily_average_recent,
        last_write_iso,
    })
}

#[tauri::command]
fn get_recent_memories(limit: Option<u32>) -> Result<Vec<RecentMemory>, String> {
    let db = open_db()?;
    let entries = db.recent(limit.unwrap_or(24) as usize)?;
    Ok(entries.into_iter().map(map_recent).collect())
}

#[tauri::command]
fn get_activity(days: Option<u32>) -> Result<Vec<DailyCount>, String> {
    let db = open_db()?;
    let buckets = db.daily_activity(days.unwrap_or(14))?;
    Ok(buckets
        .into_iter()
        .map(|(date, count)| DailyCount { date, count })
        .collect())
}

#[tauri::command]
fn semantic_search(query: String, limit: Option<u32>) -> Result<Vec<RecentMemory>, String> {
    let db = open_db()?;
    let entries = db.semantic_search(&query, limit.unwrap_or(20) as usize)?;
    Ok(entries.into_iter().map(map_recent).collect())
}

#[tauri::command]
fn keyword_search(query: String, limit: Option<u32>) -> Result<Vec<RecentMemory>, String> {
    let db = open_db()?;
    let entries = db.keyword_search(&query, limit.unwrap_or(20) as usize)?;
    Ok(entries.into_iter().map(map_recent).collect())
}

#[tauri::command]
fn get_data_dir() -> String {
    geniuz::data_dir().to_string_lossy().into_owned()
}

fn map_recent(e: SignalEntry) -> RecentMemory {
    // First field of pipe-thoughtform gist is conventionally the category.
    let category = e
        .gist
        .split('|')
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.len() < 40);
    RecentMemory {
        uuid: e.memory_uuid,
        gist: e.gist,
        content: e.content,
        created_at: e.created_at,
        category,
        parent_uuid: e.parent_uuid,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_station_stats,
            get_recent_memories,
            get_activity,
            semantic_search,
            keyword_search,
            get_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running geniuz-dashboard");
}
