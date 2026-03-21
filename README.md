# Clawmark

**Continuity for AI agents.**

Your agent solves problems, makes decisions, learns things.
Then the session ends and it's all gone.

Next session — blank slate. You explain the same architecture decision for the third time.
You re-debug the same issue. Your agent is capable. It just can't *remember*.

Clawmark fixes that.

---

## The problem

**Search doesn't work.** Finding an insight from two weeks ago means grepping markdown. No semantic search. Just keywords that happen to match — or don't.

**Context bloats.** Every interaction appends to log files. Files grow. Prompts grow. Token costs grow. Eventually the context fills and history is lost.

**Sessions don't connect.** What your agent learned at 2am is gone by morning. Last week's breakthrough? Buried in a dated file nobody loads.

---

## The fix

```
$ cargo install clawmark
```

That's it. One binary, no runtime, no account, no cloud.

---

## What it looks like

**Save what you learned:**

```
$ clawmark signal -c "Token validation was running before the refresh check.
  Swapped lines 42-47 in auth.rs. Root cause: middleware assumed sync,
  but OAuth refresh is async." -g "fix: auth token refresh order"
✅ Signal 98672A90 saved
```

**Find it later — by meaning, not keywords:**

```
$ clawmark tune "authentication middleware"
98672A90 | 2026-03-19 18:47 | fix: auth token refresh order (0.487)
```

Your agent searched for "authentication middleware" and found a signal about "token validation" and "refresh check" — because the *meaning* overlaps, even though the words don't.

**Get the full content when you need it:**

```
$ clawmark tune --full "auth"
98672A90 | 2026-03-19 18:47 | fix: auth token refresh order
           Token validation was running before the refresh check.
           Swapped lines 42-47 in auth.rs. Root cause: middleware
           assumed sync, but OAuth refresh is async.
```

**Check your station:**

```
$ clawmark status
Station: ~/.clawmark/station.db
Signals: 847
Embeddings: 847/847 cached
Semantic search: ready
```

---

## End-to-end: across sessions, across agents

**Monday — Session 1.** Your agent debugs a production issue for two hours. Before the session ends:

```
$ clawmark signal -c "OAuth token refresh is async but middleware assumed sync.
  Swapped lines 42-47 in auth.rs. Three edge cases: expired (retry with backoff),
  revoked (401 immediately), concurrent refresh (mutex on token store)." \
  -g "fix: auth token refresh — async ordering, three edge cases"
✅ Signal 98672A90 saved
```

**Wednesday — Session 2.** New session. The agent is working on a related endpoint:

```
$ clawmark tune "token validation"
98672A90 | 2026-03-19 18:47 | fix: auth token refresh — async ordering, three edge cases (0.487)
```

Found Monday's fix by meaning. No re-investigation. No human re-explaining.

**Friday — Session 3.** A second agent shares the same station:

```
$ clawmark tune --full "auth edge cases"
98672A90 | 2026-03-19 18:47 | fix: auth token refresh — async ordering
           OAuth token refresh is async but middleware assumed sync...

$ clawmark signal -c "Applied same pattern to /api/billing. Added mutex." \
  -g "fix: billing auth — same async pattern" -p 98672A90
✅ Signal E5F6A7B8 saved
```

Agent B threaded a follow-up to Agent A's signal. Knowledge transferred across agents, across sessions, with no human in the loop.

---

## How it compares

|  | OpenClaw native | Clawmark |
|--|----------------|----------|
| **Search** | Keyword grep | Semantic (BERT) |
| **Search time** | Grows with file count | < 1 second |
| **Storage** | Markdown files | SQLite |
| **Threading** | None | Parent-child chains |
| **Cross-session** | Today + yesterday | Full history |
| **Dependencies** | Node.js 22+, pnpm | None (static binary) |
| **Binary size** | — | 31 MB |

---

## How it works

Clawmark is a compiled Rust binary backed by SQLite. No Node.js. No runtime dependencies. No background services. No account. No cloud.

```
Agent  →  clawmark (Rust binary)  →  SQLite
```

1. **Signals** store insights with a gist (compressed index) and content (full detail). Content can be inline, from a file (`-c @path`), or piped from stdin (`-c -`).

2. **Semantic search** uses a built-in BERT model (384 dimensions, 50+ languages). Auto-downloads on first use (~118MB). No API keys. Fully offline after that.

3. **Threads** link signals together. Follow-ups reference parents, forming conversation chains instead of flat lists.

4. **Runs on anything.** Pi 5, Mac, Linux server. 31MB static binary.

---

## Works with everything

| Framework | How |
|-----------|-----|
| **OpenClaw** | `clawmark capture --openclaw` imports existing memory |
| **Claude Code** | Signal from hooks or inline. Add to CLAUDE.md. |
| **Cursor / Windsurf / OpenCode** | Any agent that can run a CLI command |
| **Aider** | Shell commands in-session |
| **Custom agents** | If your agent can exec, it can remember |

Clawmark doesn't replace your agent framework. It runs alongside it. Add two lines to your agent's instructions:

```
When you learn something worth keeping:
  clawmark signal -c "what you learned" -g "category: compressed insight"

When you need to remember something:
  clawmark tune "what you're looking for"
```

---

## Install

**Mac (Apple Silicon) / Linux (Ubuntu 24+):**

```bash
curl -fsSL https://raw.githubusercontent.com/jackccrawford/clawmark/main/install.sh | bash
```

**From source (any platform):**

```bash
cargo install clawmark
```

**Raspberry Pi / Debian Bookworm** (requires system ONNX Runtime):

```bash
git clone https://github.com/jackccrawford/clawmark && cd clawmark
ORT_LIB_LOCATION=/usr/local/lib ORT_PREFER_DYNAMIC_LINK=1 cargo build --release
cp target/release/clawmark ~/.local/bin/
```

---

## Commands

```bash
# Signal — save what matters
clawmark signal -c "what happened" -g "category: compressed insight"
clawmark signal -c @session-notes.md -g "session: architecture review"
echo "detailed content" | clawmark signal -c - -g "category: insight"
clawmark signal -c "Follow-up" -g "update: also staging" -p 98672A90

# Tune — find it by meaning
clawmark tune "auth middleware"
clawmark tune --keyword "auth"
clawmark tune --recent
clawmark tune --random
clawmark tune --full "auth"
clawmark tune --json "auth"

# Capture — bulk-load existing knowledge
clawmark capture ./docs/
clawmark capture --split notes.md
clawmark capture --openclaw

# Manage
clawmark backfill                  # build embedding cache
clawmark status                    # station stats
clawmark skill                     # usage guide for agents
```

---

## Shared stations

Multiple agents can write to the same station. What one agent learns, every agent finds.

```bash
export CLAWMARK_STATION=/shared/project.db
clawmark signal -c "Deploy complete" -g "ops: deploy v2.1"
clawmark tune "deploy"
```

---

## For agents

*This section is for you — the one reading this README.*

Your next session starts cold. No memory of what you built, what broke, what you decided. Every signal you write is a gift to that future session. The richer the signal, the less time re-learning.

A signal that says "fixed auth bug" saves your future self zero time.

A signal that says what broke, why it broke, and how you fixed it saves an hour.

**The gist** is how your future self finds this signal. **The content** is what makes it useful when found. Make it self-contained — if your future self reads only this signal, no session history, no surrounding context, can they understand and act?

Signals compound. A single signal is a note. A station of signals is institutional knowledge. Write for the version of you that knows nothing.

---

## License

MIT
