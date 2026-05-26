//! Database layer — signals, embedding cache, search

use rusqlite::{Connection, OptionalExtension};
use std::path::Path;

pub struct DatabaseManager {
    pub db_path: String,
}

impl DatabaseManager {
    pub fn new(db_path: &str) -> Result<Self, String> {
        if let Some(parent) = Path::new(db_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("Failed to enable WAL: {}", e))?;
        conn.busy_timeout(std::time::Duration::from_secs(30))
            .map_err(|e| format!("Failed to set timeout: {}", e))?;

        // Check for existing schema
        let has_memories: bool = conn.query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memories'",
            [], |_| Ok(true),
        ).unwrap_or(false);

        let has_legacy: bool = conn.query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='signals'",
            [], |_| Ok(true),
        ).unwrap_or(false);

        if has_legacy && !has_memories {
            // Migrate old schema: signals → memories, signal_uuid → memory_uuid
            conn.execute_batch("
                ALTER TABLE signals RENAME TO memories;
                ALTER TABLE memories RENAME COLUMN signal_uuid TO memory_uuid;
                ALTER TABLE signal_embeddings RENAME TO memory_embeddings;
                ALTER TABLE memory_embeddings RENAME COLUMN signal_uuid TO memory_uuid;
                DROP VIEW IF EXISTS signal_chains;
                DROP TRIGGER IF EXISTS prevent_signal_delete;
                DROP TRIGGER IF EXISTS prevent_signal_update;
            ").map_err(|e| format!("Failed to migrate schema: {}", e))?;
            // Recreate views and triggers with new names
            let schema = include_str!("../schema/schema.sql");
            conn.execute_batch(schema)
                .map_err(|e| format!("Failed to apply schema after migration: {}", e))?;
            eprintln!("[geniuz] Migrated legacy schema (signals → memories)");
        } else if !has_memories {
            // Fresh database — create from scratch
            let schema = include_str!("../schema/schema.sql");
            conn.execute_batch(schema)
                .map_err(|e| format!("Failed to init schema: {}", e))?;
        }

        Ok(Self { db_path: db_path.to_string() })
    }

    fn conn(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        conn.busy_timeout(std::time::Duration::from_secs(30))
            .map_err(|e| format!("Failed to set timeout: {}", e))?;
        Ok(conn)
    }

    // =========================================================================
    // SIGNAL (write)
    // =========================================================================

    /// Insert a signal with optional gist and parent. Returns short UUID.
    /// Embeds content inline if no backend is provided (creates one per call).
    pub fn signal(
        &self, content: &str, gist: Option<&str>, parent: Option<&str>,
        created_at: Option<&str>,
    ) -> Result<String, String> {
        self.signal_with_backend(content, gist, parent, created_at, None)
    }

    /// Insert a signal, optionally reusing a pre-created embedding backend.
    pub fn signal_with_backend(
        &self, content: &str, gist: Option<&str>, parent: Option<&str>,
        created_at: Option<&str>,
        backend: Option<&dyn crate::embedding::EmbeddingBackend>,
    ) -> Result<String, String> {
        if content.trim().is_empty() {
            return Err("Content cannot be empty".to_string());
        }

        let uuid = uuid::Uuid::new_v4().to_string().to_uppercase();
        let auto_gist = gist.map(|g| g.to_string()).unwrap_or_else(|| {
            let trimmed = content.trim();
            if trimmed.len() <= 200 { trimmed.to_string() }
            else { format!("{}...", &trimmed[..197]) }
        });

        let payload = serde_json::json!({
            "content": content.trim(),
            "gist": auto_gist,
        });
        let payload_str = serde_json::to_string(&payload)
            .map_err(|e| format!("Failed to serialize: {}", e))?;

        let parent_uuid = if let Some(p) = parent {
            self.resolve_uuid(p)?.unwrap_or(uuid.clone())
        } else {
            uuid.clone()
        };

        // Embed content first, but tolerate embedding failure. The invariant:
        // every memory is *searchable* — by semantic search when a backend is
        // healthy, or by keyword search always. A write never fails just
        // because ONNX and Ollama are both down.
        //
        // Chain: ONNX → Ollama → keyword-only (soft fail).
        // When both embedding backends are unavailable, we log to stderr and
        // proceed with memory-without-embedding. The memory lands in the
        // memories table; no embedding row is created for it. Keyword search
        // (geniuz recall --keyword) still finds it. Semantic search does not
        // until someone runs `geniuz backfill` with a working backend.
        let embedding = if let Some(b) = backend {
            b.embed(content).ok()
        } else {
            crate::embedding::embed_content(content).ok()
        };

        if embedding.is_none() {
            eprintln!(
                "[geniuz] Embedding unavailable — memory {} saved with keyword search only. Run 'geniuz backfill' later to add semantic search.",
                &uuid[..8]
            );
        }

        // Insert memory + (optional) embedding atomically in one transaction
        let conn = self.conn()?;
        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        if let Some(ts) = created_at {
            tx.execute(
                "INSERT INTO memories (memory_uuid, payload, created_at, parent_uuid) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![&uuid, &payload_str, ts, &parent_uuid],
            ).map_err(|e| format!("Failed to insert: {}", e))?;
        } else {
            tx.execute(
                "INSERT INTO memories (memory_uuid, payload, created_at, parent_uuid) VALUES (?1, ?2, datetime('now', 'utc'), ?3)",
                rusqlite::params![&uuid, &payload_str, &parent_uuid],
            ).map_err(|e| format!("Failed to insert: {}", e))?;
        }
        if let Some(emb) = &embedding {
            let blob = crate::embedding::embedding_to_blob(emb);
            tx.execute(
                "INSERT INTO memory_embeddings (memory_uuid, embedding) VALUES (?1, ?2)",
                rusqlite::params![&uuid, blob],
            ).map_err(|e| format!("Failed to cache embedding: {}", e))?;
        }
        tx.commit().map_err(|e| format!("Failed to commit: {}", e))?;

        Ok(uuid[..8].to_string())
    }

    // =========================================================================
    // TUNE (read)
    // =========================================================================

    pub fn recent(&self, limit: usize) -> Result<Vec<SignalEntry>, String> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT memory_uuid,
                    COALESCE(json_extract(payload, '$.gist'), substr(json_extract(payload, '$.content'), 1, 200)) as gist,
                    created_at, parent_uuid
             FROM memories ORDER BY created_at DESC LIMIT ?1"
        ).map_err(|e| format!("Query failed: {}", e))?;

        let rows = stmt.query_map(rusqlite::params![limit as i32], |row| {
            let uuid: String = row.get(0)?;
            let parent: Option<String> = row.get(3)?;
            let display_parent = parent.filter(|p| p != &uuid);
            Ok(SignalEntry {
                memory_uuid: uuid, gist: row.get(1)?, created_at: row.get(2)?,
                parent_uuid: display_parent, content: None, score: None,
            })
        }).map_err(|e| format!("Query failed: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Get signals created after a given timestamp, ordered oldest first.
    pub fn since(&self, timestamp: &str, limit: usize) -> Result<Vec<SignalEntry>, String> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT memory_uuid,
                    COALESCE(json_extract(payload, '$.gist'), substr(json_extract(payload, '$.content'), 1, 200)) as gist,
                    created_at, parent_uuid, json_extract(payload, '$.content')
             FROM memories WHERE created_at > ?1 ORDER BY created_at ASC LIMIT ?2"
        ).map_err(|e| format!("Query failed: {}", e))?;

        let rows = stmt.query_map(rusqlite::params![timestamp, limit as i32], |row| {
            let uuid: String = row.get(0)?;
            let parent: Option<String> = row.get(3)?;
            let display_parent = parent.filter(|p| p != &uuid);
            Ok(SignalEntry {
                memory_uuid: uuid, gist: row.get(1)?, created_at: row.get(2)?,
                parent_uuid: display_parent, content: row.get(4)?, score: None,
            })
        }).map_err(|e| format!("Query failed: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Direct retrieval by UUID prefix (e.g. 8-char display form) or full 36-char UUID.
    /// Returns the matching SignalEntry, or None if no memory matches. Case-insensitive
    /// on the input; memories store UUIDs uppercase. Used by `recall` to short-circuit
    /// UUID-shaped queries before falling through to semantic search — a UUID-shaped
    /// query has no useful semantic content to embed, so treating it as a lookup key
    /// is the honest thing to do.
    pub fn get_by_uuid_prefix(&self, prefix: &str) -> Result<Option<SignalEntry>, String> {
        let conn = self.conn()?;
        let pattern = format!("{}%", prefix.to_uppercase());
        let mut stmt = conn.prepare(
            "SELECT memory_uuid,
                    COALESCE(json_extract(payload, '$.gist'), substr(json_extract(payload, '$.content'), 1, 200)) as gist,
                    created_at, parent_uuid, json_extract(payload, '$.content')
             FROM memories WHERE memory_uuid LIKE ?1 LIMIT 1"
        ).map_err(|e| format!("Query failed: {}", e))?;

        let mut rows = stmt.query(rusqlite::params![pattern])
            .map_err(|e| format!("Query failed: {}", e))?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let uuid: String = row.get(0).map_err(|e| e.to_string())?;
            let parent: Option<String> = row.get(3).map_err(|e| e.to_string())?;
            let display_parent = parent.filter(|p| p != &uuid);
            Ok(Some(SignalEntry {
                memory_uuid: uuid,
                gist: row.get(1).map_err(|e| e.to_string())?,
                created_at: row.get(2).map_err(|e| e.to_string())?,
                parent_uuid: display_parent,
                content: row.get(4).map_err(|e| e.to_string())?,
                score: None,
            }))
        } else {
            Ok(None)
        }
    }

    /// Get the created_at timestamp of a signal by UUID prefix.
    pub fn get_signal_timestamp(&self, uuid_prefix: &str) -> Result<Option<String>, String> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT created_at FROM memories WHERE memory_uuid LIKE ?1 LIMIT 1",
            rusqlite::params![format!("{}%", uuid_prefix.to_uppercase())],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Query failed: {}", e))
    }

    pub fn keyword_search(&self, query: &str, limit: usize) -> Result<Vec<SignalEntry>, String> {
        let terms: Vec<&str> = query.split_whitespace().collect();
        if terms.is_empty() { return self.recent(limit); }

        // Build parameterized LIKE conditions: ?1, ?2, ... for terms, ?N+1 for limit
        let conditions: Vec<String> = (0..terms.len())
            .map(|i| format!("payload LIKE ?{}", i + 1))
            .collect();
        let where_clause = conditions.join(" OR ");
        let limit_param = terms.len() + 1;

        let sql = format!(
            "SELECT memory_uuid,
                    COALESCE(json_extract(payload, '$.gist'), substr(json_extract(payload, '$.content'), 1, 200)) as gist,
                    created_at, parent_uuid
             FROM memories WHERE {} ORDER BY created_at DESC LIMIT ?{}",
            where_clause, limit_param
        );

        let conn = self.conn()?;
        let mut stmt = conn.prepare(&sql).map_err(|e| format!("Query failed: {}", e))?;

        // Bind search terms as %term% patterns, then limit
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = terms.iter()
            .map(|t| Box::new(format!("%{}%", t)) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        params.push(Box::new(limit as i32));

        let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
            let uuid: String = row.get(0)?;
            let parent: Option<String> = row.get(3)?;
            let display_parent = parent.filter(|p| p != &uuid);
            Ok(SignalEntry {
                memory_uuid: uuid, gist: row.get(1)?, created_at: row.get(2)?,
                parent_uuid: display_parent, content: None, score: None,
            })
        }).map_err(|e| format!("Query failed: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn semantic_search(&self, query: &str, limit: usize) -> Result<Vec<SignalEntry>, String> {
        let cached = self.get_cached_embeddings()?;
        if cached.is_empty() {
            eprintln!("[geniuz] No embedding cache. Run: geniuz backfill");
            return self.keyword_search(query, limit);
        }

        let results = crate::embedding::semantic_search_cached(query, cached, limit)?;
        Ok(results.into_iter().map(|r| SignalEntry {
            memory_uuid: r.memory_uuid, gist: r.gist, created_at: r.created_at,
            parent_uuid: None, content: None, score: Some(r.score),
        }).collect())
    }

    pub fn random(&self) -> Result<Option<SignalEntry>, String> {
        let conn = self.conn()?;
        let result = conn.query_row(
            "SELECT memory_uuid,
                    COALESCE(json_extract(payload, '$.gist'), substr(json_extract(payload, '$.content'), 1, 200)),
                    created_at, parent_uuid
             FROM memories ORDER BY RANDOM() LIMIT 1",
            [], |row| {
                let uuid: String = row.get(0)?;
                let parent: Option<String> = row.get(3)?;
                let display_parent = parent.filter(|p| p != &uuid);
                Ok(SignalEntry {
                    memory_uuid: uuid, gist: row.get(1)?, created_at: row.get(2)?,
                    parent_uuid: display_parent, content: None, score: None,
                })
            },
        ).optional().map_err(|e| format!("Query failed: {}", e))?;
        Ok(result)
    }

    pub fn get_full_content(&self, uuid: &str) -> Result<Option<String>, String> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT json_extract(payload, '$.content') FROM memories WHERE memory_uuid = ?1",
            rusqlite::params![uuid], |row| row.get(0),
        ).optional().map_err(|e| format!("Query failed: {}", e))
    }

    pub fn count(&self) -> Result<usize, String> {
        let conn = self.conn()?;
        let c: i64 = conn.query_row("SELECT COUNT(*) FROM memories", [], |r| r.get(0))
            .map_err(|e| format!("Count failed: {}", e))?;
        Ok(c as usize)
    }

    /// Count of distinct conversation roots (memories with no parent + orphan
    /// groups). Each memory belongs to exactly one root via parent_uuid threading.
    pub fn thread_count(&self) -> Result<usize, String> {
        let conn = self.conn()?;
        let c: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT COALESCE(parent_uuid, memory_uuid)) FROM memories",
            [],
            |r| r.get(0),
        ).map_err(|e| format!("Thread count failed: {}", e))?;
        Ok(c as usize)
    }

    /// Count of memories created in the last `days` days.
    pub fn count_since_days(&self, days: u32) -> Result<usize, String> {
        let conn = self.conn()?;
        let modifier = format!("-{} days", days);
        let c: i64 = conn.query_row(
            "SELECT COUNT(*) FROM memories WHERE created_at >= datetime('now', ?1)",
            rusqlite::params![modifier],
            |r| r.get(0),
        ).map_err(|e| format!("Count-since-days failed: {}", e))?;
        Ok(c as usize)
    }

    /// Daily memory counts for the last `days` days, ordered oldest-first.
    /// Returns (date_iso, count) pairs for days that have activity. Days with
    /// zero memories are omitted; callers fill zeros as needed for charting.
    pub fn daily_activity(&self, days: u32) -> Result<Vec<(String, usize)>, String> {
        let conn = self.conn()?;
        let modifier = format!("-{} days", days);
        let mut stmt = conn.prepare(
            "SELECT date(created_at) as day, COUNT(*) as count
             FROM memories
             WHERE created_at >= datetime('now', ?1)
             GROUP BY day ORDER BY day ASC",
        ).map_err(|e| format!("Query failed: {}", e))?;
        let rows = stmt.query_map(rusqlite::params![modifier], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
        }).map_err(|e| format!("Query failed: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Timestamp of the most recent memory (ISO 8601 UTC), or None if empty.
    /// Used for "last write Xm ago" displays.
    pub fn last_write_timestamp(&self) -> Result<Option<String>, String> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT MAX(created_at) FROM memories",
            [],
            |row| row.get::<_, Option<String>>(0),
        ).map_err(|e| format!("Query failed: {}", e))
    }

    /// All memories in the same thread as `uuid`, ordered oldest-first.
    /// A thread is the recursive ancestor chain plus all descendants —
    /// every memory sharing the same root via parent_uuid.
    pub fn thread_for(&self, uuid: &str, limit: usize) -> Result<Vec<SignalEntry>, String> {
        let resolved = self.resolve_uuid(uuid)?
            .ok_or_else(|| format!("Memory not found: {}", uuid))?;
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "WITH target AS (
                SELECT root_uuid FROM memory_chains WHERE memory_uuid = ?1 LIMIT 1
             )
             SELECT m.memory_uuid,
                    COALESCE(json_extract(m.payload, '$.gist'), substr(json_extract(m.payload, '$.content'), 1, 200)) as gist,
                    m.created_at,
                    m.parent_uuid,
                    json_extract(m.payload, '$.content') as content
             FROM memories m
             JOIN memory_chains c ON c.memory_uuid = m.memory_uuid
             WHERE c.root_uuid = (SELECT root_uuid FROM target)
             ORDER BY m.created_at ASC
             LIMIT ?2",
        ).map_err(|e| format!("Query failed: {}", e))?;
        let rows = stmt.query_map(rusqlite::params![resolved, limit], |row| {
            Ok(SignalEntry {
                memory_uuid: row.get(0)?,
                gist: row.get(1)?,
                created_at: row.get(2)?,
                parent_uuid: row.get(3)?,
                content: row.get(4)?,
                score: None,
            })
        }).map_err(|e| format!("Query failed: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Currently-configured embedding model name, or None if not set.
    pub fn get_embedding_model(&self) -> Result<Option<String>, String> {
        let conn = self.conn()?;
        let opt: Option<String> = conn.query_row(
            "SELECT value FROM embedding_meta WHERE key = 'model'",
            [],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Query failed: {}", e))?;
        Ok(opt)
    }

    fn resolve_uuid(&self, partial: &str) -> Result<Option<String>, String> {
        if partial.len() == 36 { return Ok(Some(partial.to_uppercase())); }
        let conn = self.conn()?;
        conn.query_row(
            "SELECT memory_uuid FROM memories WHERE memory_uuid LIKE ?1 LIMIT 1",
            rusqlite::params![format!("{}%", partial.to_uppercase())],
            |row| row.get(0),
        ).optional().map_err(|e| format!("UUID resolve failed: {}", e))
    }

    // =========================================================================
    // EMBEDDING CACHE
    // =========================================================================

    pub fn cache_embedding(&self, uuid: &str, embedding: &[f32]) -> Result<(), String> {
        let conn = self.conn()?;
        let blob = crate::embedding::embedding_to_blob(embedding);
        conn.execute(
            "INSERT OR REPLACE INTO memory_embeddings (memory_uuid, embedding) VALUES (?1, ?2)",
            rusqlite::params![uuid, blob],
        ).map_err(|e| format!("Cache write failed: {}", e))?;
        Ok(())
    }

    pub fn get_cached_embeddings(&self) -> Result<Vec<crate::embedding::CachedEmbedding>, String> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT e.memory_uuid,
                    COALESCE(json_extract(s.payload, '$.gist'), substr(json_extract(s.payload, '$.content'), 1, 120)),
                    s.created_at, e.embedding
             FROM memory_embeddings e
             JOIN memories s ON s.memory_uuid = e.memory_uuid"
        ).map_err(|e| format!("Query failed: {}", e))?;

        let rows = stmt.query_map([], |row| {
            let blob: Vec<u8> = row.get(3)?;
            let uuid: String = row.get(0)?;
            match crate::embedding::blob_to_embedding(&blob) {
                Ok(embedding) => Ok(Some(crate::embedding::CachedEmbedding {
                    memory_uuid: uuid, gist: row.get(1)?,
                    created_at: row.get(2)?, embedding,
                })),
                Err(e) => {
                    eprintln!("[geniuz] Skipping corrupted embedding for {}: {}", &uuid[..8.min(uuid.len())], e);
                    Ok(None)
                }
            }
        }).map_err(|e| format!("Query failed: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map(|v| v.into_iter().flatten().collect())
            .map_err(|e| e.to_string())
    }

    pub fn get_uncached_signals(&self) -> Result<Vec<(String, String)>, String> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT s.memory_uuid, json_extract(s.payload, '$.content')
             FROM memories s
             LEFT JOIN memory_embeddings e ON e.memory_uuid = s.memory_uuid
             WHERE json_extract(s.payload, '$.content') IS NOT NULL
               AND e.memory_uuid IS NULL"
        ).map_err(|e| format!("Query failed: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| format!("Query failed: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn embedding_count(&self) -> Result<usize, String> {
        let conn = self.conn()?;
        let c: i64 = conn.query_row("SELECT COUNT(*) FROM memory_embeddings", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(c as usize)
    }

    pub fn set_embedding_model(&self, model: &str) -> Result<(), String> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT OR REPLACE INTO embedding_meta (key, value) VALUES ('model', ?1)",
            rusqlite::params![model],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct SignalEntry {
    pub memory_uuid: String,
    pub gist: String,
    pub created_at: String,
    pub parent_uuid: Option<String>,
    pub content: Option<String>,
    pub score: Option<f32>,
}

// =============================================================================
// Tests
// =============================================================================
//
// Coverage focus: the load-bearing write/read paths that every surface (CLI,
// TUI, dashboard, MCP) depends on. Embedding is bypassed with a MockBackend
// returning a fixed zero vector so tests don't require downloading the ONNX
// model — write/read correctness is what we're verifying, not semantic search
// quality (which has its own embedding-specific tests in embedding.rs).
//
// Pattern: each test gets its own tempdir and DatabaseManager so they don't
// share state and can run in parallel.

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// 384-dim zero vector — same dimension as paraphrase-multilingual-MiniLM-L12-v2
    /// (the production embedding model). Lets us exercise the write path that
    /// stores embeddings without invoking the real ONNX backend.
    const MOCK_DIM: usize = 384;

    struct MockBackend;
    impl crate::embedding::EmbeddingBackend for MockBackend {
        fn embed(&self, _text: &str) -> Result<Vec<f32>, String> {
            Ok(vec![0.0; MOCK_DIM])
        }
        fn name(&self) -> &str {
            "mock-backend-for-tests"
        }
    }

    /// Build a fresh DatabaseManager in a per-test tempdir. Returns the
    /// tempdir guard so the caller keeps it alive for the test's lifetime.
    fn fresh_db() -> (DatabaseManager, tempfile::TempDir) {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("memory.db");
        let db = DatabaseManager::new(db_path.to_str().unwrap())
            .expect("DatabaseManager::new on fresh path");
        (db, dir)
    }

    /// Shortcut: insert a signal with the mock backend and return its short UUID.
    fn insert(db: &DatabaseManager, content: &str, gist: Option<&str>, parent: Option<&str>) -> String {
        db.signal_with_backend(content, gist, parent, None, Some(&MockBackend))
            .expect("signal_with_backend")
    }

    #[test]
    fn new_initializes_schema_on_fresh_path() {
        let (db, _dir) = fresh_db();
        // Schema is in place: count() should succeed and return 0.
        assert_eq!(db.count().unwrap(), 0);
    }

    #[test]
    fn count_is_zero_on_empty_db() {
        let (db, _dir) = fresh_db();
        assert_eq!(db.count().unwrap(), 0);
        assert_eq!(db.thread_count().unwrap(), 0);
        assert_eq!(db.embedding_count().unwrap(), 0);
    }

    #[test]
    fn signal_returns_eight_char_uppercase_uuid() {
        let (db, _dir) = fresh_db();
        let short = insert(&db, "first memory", Some("test gist"), None);
        assert_eq!(short.len(), 8, "short uuid is 8 chars");
        assert_eq!(short, short.to_uppercase(), "short uuid is uppercase");
    }

    #[test]
    fn signal_rejects_empty_content() {
        let (db, _dir) = fresh_db();
        let err = db
            .signal_with_backend("", Some("gist"), None, None, Some(&MockBackend))
            .expect_err("empty content should error");
        assert!(err.contains("empty"), "error mentions emptiness: {}", err);
    }

    #[test]
    fn signal_rejects_whitespace_only_content() {
        let (db, _dir) = fresh_db();
        let err = db
            .signal_with_backend("   \n\t  ", None, None, None, Some(&MockBackend))
            .expect_err("whitespace-only content should error");
        assert!(err.contains("empty"), "error mentions emptiness: {}", err);
    }

    #[test]
    fn signal_auto_derives_gist_from_short_content() {
        let (db, _dir) = fresh_db();
        let short = insert(&db, "remembered something small", None, None);
        let entries = db.recent(10).unwrap();
        let entry = entries.iter().find(|e| e.memory_uuid.starts_with(&short)).expect("inserted entry");
        assert_eq!(entry.gist, "remembered something small");
    }

    #[test]
    fn signal_truncates_auto_gist_for_long_content() {
        let (db, _dir) = fresh_db();
        // 300-char content — auto-gist truncates at 197 + "..."
        let long = "x".repeat(300);
        let short = insert(&db, &long, None, None);
        let entries = db.recent(10).unwrap();
        let entry = entries.iter().find(|e| e.memory_uuid.starts_with(&short)).expect("inserted entry");
        assert_eq!(entry.gist.len(), 200, "auto-gist is exactly 200 chars (197 + '...')");
        assert!(entry.gist.ends_with("..."), "auto-gist ends with ellipsis");
    }

    #[test]
    fn count_reflects_inserts() {
        let (db, _dir) = fresh_db();
        for i in 0..5 {
            insert(&db, &format!("memory number {}", i), None, None);
        }
        assert_eq!(db.count().unwrap(), 5);
        // All root memories — distinct threads.
        assert_eq!(db.thread_count().unwrap(), 5);
    }

    #[test]
    fn embedding_count_matches_inserts_when_backend_provided() {
        let (db, _dir) = fresh_db();
        for i in 0..3 {
            insert(&db, &format!("memory {}", i), None, None);
        }
        assert_eq!(db.embedding_count().unwrap(), 3);
    }

    #[test]
    fn recent_returns_newest_first() {
        let (db, _dir) = fresh_db();
        // Use explicit timestamps so ordering is deterministic without sleeping.
        db.signal_with_backend("oldest", Some("oldest"), None, Some("2026-01-01 00:00:00"), Some(&MockBackend))
            .unwrap();
        db.signal_with_backend("middle", Some("middle"), None, Some("2026-02-01 00:00:00"), Some(&MockBackend))
            .unwrap();
        db.signal_with_backend("newest", Some("newest"), None, Some("2026-03-01 00:00:00"), Some(&MockBackend))
            .unwrap();
        let entries = db.recent(10).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].gist, "newest");
        assert_eq!(entries[1].gist, "middle");
        assert_eq!(entries[2].gist, "oldest");
    }

    #[test]
    fn recent_respects_limit() {
        let (db, _dir) = fresh_db();
        for i in 0..10 {
            insert(&db, &format!("memory {}", i), None, None);
        }
        let entries = db.recent(3).unwrap();
        assert_eq!(entries.len(), 3);
    }

    #[test]
    fn get_by_uuid_prefix_returns_none_for_unknown() {
        let (db, _dir) = fresh_db();
        assert!(db.get_by_uuid_prefix("DEADBEEF").unwrap().is_none());
    }

    #[test]
    fn get_by_uuid_prefix_resolves_short_uuid() {
        let (db, _dir) = fresh_db();
        let short = insert(&db, "find me", Some("findable"), None);
        let entry = db.get_by_uuid_prefix(&short).unwrap().expect("found by prefix");
        assert_eq!(entry.gist, "findable");
        assert!(entry.memory_uuid.starts_with(&short));
    }

    #[test]
    fn root_memory_displays_with_no_parent() {
        let (db, _dir) = fresh_db();
        let short = insert(&db, "root memory", None, None);
        let entry = db.get_by_uuid_prefix(&short).unwrap().expect("entry");
        // Root memories self-parent internally (memory_uuid == parent_uuid in the
        // table), but get_by_uuid_prefix deliberately hides that on read so
        // callers see root memories as parent-less. This keeps display surfaces
        // (CLI, TUI, dashboard) from showing "thread continues from itself".
        assert!(entry.parent_uuid.is_none(), "root memory presents as parent-less; got {:?}", entry.parent_uuid);
    }

    #[test]
    fn signal_threads_to_parent_via_short_uuid() {
        let (db, _dir) = fresh_db();
        let parent_short = insert(&db, "parent memory", Some("parent"), None);
        let _child_short = insert(&db, "child memory", Some("child"), Some(&parent_short));
        // Parent has one descendant in its thread (parent + 1 child).
        let chain = db.thread_for(&parent_short, 10).unwrap();
        assert!(
            chain.len() >= 2,
            "thread chain includes parent and child (got {} entries)",
            chain.len()
        );
    }

    #[test]
    fn keyword_search_finds_substring_match() {
        let (db, _dir) = fresh_db();
        insert(&db, "authentication token refresh order fix", Some("fix: auth order"), None);
        insert(&db, "unrelated note about database", Some("note: db"), None);
        insert(&db, "more on authentication flow", Some("auth: flow"), None);
        let results = db.keyword_search("authentication", 10).unwrap();
        assert_eq!(results.len(), 2, "two memories match 'authentication'");
    }

    #[test]
    fn keyword_search_respects_limit() {
        let (db, _dir) = fresh_db();
        for i in 0..10 {
            insert(&db, &format!("matching memory {}", i), None, None);
        }
        let results = db.keyword_search("matching", 3).unwrap();
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn last_write_timestamp_returns_none_on_empty_db() {
        let (db, _dir) = fresh_db();
        assert!(db.last_write_timestamp().unwrap().is_none());
    }

    #[test]
    fn last_write_timestamp_reflects_most_recent_insert() {
        let (db, _dir) = fresh_db();
        db.signal_with_backend("first", None, None, Some("2026-01-01 12:00:00"), Some(&MockBackend))
            .unwrap();
        db.signal_with_backend("last", None, None, Some("2026-06-15 09:30:00"), Some(&MockBackend))
            .unwrap();
        let ts = db.last_write_timestamp().unwrap().expect("has timestamp");
        assert!(ts.starts_with("2026-06-15"), "got: {}", ts);
    }

    #[test]
    fn count_since_days_filters_by_time_window() {
        let (db, _dir) = fresh_db();
        // Insert one very old, one recent.
        db.signal_with_backend("old", None, None, Some("2020-01-01 00:00:00"), Some(&MockBackend))
            .unwrap();
        let recent_ts = chrono::Utc::now()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        db.signal_with_backend("recent", None, None, Some(&recent_ts), Some(&MockBackend))
            .unwrap();
        // 30-day window catches only the recent.
        let n = db.count_since_days(30).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn daily_activity_buckets_by_day() {
        let (db, _dir) = fresh_db();
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        db.signal_with_backend("a", None, None, Some(&format!("{} 09:00:00", today)), Some(&MockBackend))
            .unwrap();
        db.signal_with_backend("b", None, None, Some(&format!("{} 14:00:00", today)), Some(&MockBackend))
            .unwrap();
        let buckets = db.daily_activity(7).unwrap();
        let today_bucket = buckets.iter().find(|(d, _)| d == &today);
        let count = today_bucket.map(|(_, n)| *n).unwrap_or(0);
        assert_eq!(count, 2, "two memories landed today; buckets: {:?}", buckets);
    }

    #[test]
    fn thread_count_distinguishes_roots_from_descendants() {
        let (db, _dir) = fresh_db();
        let root_a = insert(&db, "thread A root", Some("A"), None);
        let _child_a = insert(&db, "A reply", None, Some(&root_a));
        let _root_b = insert(&db, "thread B root", Some("B"), None);
        // Two roots → two threads, regardless of descendants.
        assert_eq!(db.thread_count().unwrap(), 2);
        // Total count is 3 (two roots + one child).
        assert_eq!(db.count().unwrap(), 3);
    }

    #[test]
    fn get_full_content_returns_content_string() {
        let (db, _dir) = fresh_db();
        let short = insert(&db, "the full content payload here", Some("short gist"), None);
        // get_full_content requires the full UUID — look it up via prefix first.
        let entry = db.get_by_uuid_prefix(&short).unwrap().expect("entry");
        let full = db.get_full_content(&entry.memory_uuid).unwrap().expect("content present");
        assert_eq!(full, "the full content payload here");
    }

    #[test]
    fn get_full_content_returns_none_for_unknown_uuid() {
        let (db, _dir) = fresh_db();
        // Pass a syntactically-plausible full UUID that doesn't exist.
        assert!(db.get_full_content("00000000-0000-0000-0000-000000000000").unwrap().is_none());
    }

    #[test]
    fn since_returns_signals_after_timestamp() {
        let (db, _dir) = fresh_db();
        db.signal_with_backend("before", Some("before"), None, Some("2026-01-01 00:00:00"), Some(&MockBackend))
            .unwrap();
        db.signal_with_backend("after", Some("after"), None, Some("2026-03-01 00:00:00"), Some(&MockBackend))
            .unwrap();
        let results = db.since("2026-02-01 00:00:00", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].gist, "after");
    }

    #[test]
    fn random_returns_none_on_empty_db() {
        let (db, _dir) = fresh_db();
        assert!(db.random().unwrap().is_none());
    }

    #[test]
    fn random_returns_some_when_signals_exist() {
        let (db, _dir) = fresh_db();
        insert(&db, "only memory", None, None);
        let entry = db.random().unwrap().expect("entry");
        assert_eq!(entry.gist, "only memory");
    }

    #[test]
    fn embedding_model_round_trips() {
        let (db, _dir) = fresh_db();
        assert!(db.get_embedding_model().unwrap().is_none(), "no model set initially");
        db.set_embedding_model("test-model-id").unwrap();
        assert_eq!(db.get_embedding_model().unwrap().as_deref(), Some("test-model-id"));
    }

    #[test]
    fn get_uncached_signals_returns_empty_when_all_cached() {
        let (db, _dir) = fresh_db();
        // Inserts with MockBackend cache embeddings, so no uncached.
        insert(&db, "memory one", None, None);
        insert(&db, "memory two", None, None);
        let uncached = db.get_uncached_signals().unwrap();
        assert_eq!(uncached.len(), 0);
    }
}
