// Quick experiment: embed prose prototype and known-category files,
// compute cosines, pick a threshold that separates them.
use geniuz::embedding;

fn main() {
    let backend = embedding::create_backend().expect("backend");

    let proto = "Natural language prose describes ideas, events, and observations using \
                 complete sentences that connect into coherent thought. Writers use \
                 punctuation to separate clauses and rely on shared vocabulary to \
                 communicate meaning between people.";
    let proto_emb = backend.embed(proto).expect("proto embed");

    // Known-junk file paths (from jackc's captures yesterday, now in Mars store too
    // via capture tests)
    let junk_files = [
        ("styles.css", "/Users/mars/Dev/docs/fleet-chronicle/styles.css"),
        ("app.js",     "/Users/mars/Dev/docs/fleet-chronicle/app.js"),
        ("index.html", "/Users/mars/Dev/docs/fleet-chronicle/index.html"),
    ];

    // Known-prose files (a sample of the markdown Jack captured)
    let prose_files = [
        ("MVARA_ARCHITECTURE.md",               "/Users/mars/Dev/docs/MVARA_ARCHITECTURE.md"),
        ("agent-centric-design.md",             "/Users/mars/Dev/docs/agent-centric-design.md"),
        ("bounded-coherence-architecture.md",   "/Users/mars/Dev/docs/bounded-coherence-architecture.md"),
        ("the_mirror_story.md",                 "/Users/mars/Dev/docs/the_mirror_story.md"),
        ("fleet-commons-spec.md",               "/Users/mars/Dev/docs/fleet-commons-spec.md"),
        ("perpetual-turn-architecture.md",      "/Users/mars/Dev/docs/perpetual-turn-architecture.md"),
    ];

    // Edge cases worth seeing
    let edge_files = [
        ("README.md (geniuz repo)",   "/Users/mars/Dev/geniuz/README.md"),
    ];

    println!("=== JUNK (should score LOW) ===");
    for (label, path) in &junk_files {
        match std::fs::read_to_string(path) {
            Ok(content) => {
                let emb = backend.embed(&content).expect("embed");
                let sim = embedding::cosine_similarity(&proto_emb, &emb);
                println!("  {:.4}  {}", sim, label);
            }
            Err(e) => println!("  [read error] {}: {}", label, e),
        }
    }

    println!("\n=== PROSE (should score HIGH) ===");
    for (label, path) in &prose_files {
        match std::fs::read_to_string(path) {
            Ok(content) => {
                let emb = backend.embed(&content).expect("embed");
                let sim = embedding::cosine_similarity(&proto_emb, &emb);
                println!("  {:.4}  {}", sim, label);
            }
            Err(e) => println!("  [read error] {}: {}", label, e),
        }
    }

    println!("\n=== EDGE ===");
    for (label, path) in &edge_files {
        match std::fs::read_to_string(path) {
            Ok(content) => {
                let emb = backend.embed(&content).expect("embed");
                let sim = embedding::cosine_similarity(&proto_emb, &emb);
                println!("  {:.4}  {}", sim, label);
            }
            Err(e) => println!("  [read error] {}: {}", label, e),
        }
    }
}
