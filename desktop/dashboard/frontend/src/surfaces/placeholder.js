// placeholder.js — for surfaces not yet implemented.
// Tier-1 ships Recent; other sidebar entries land here with a clear note.

const COPY = {
  find: {
    title: 'Find',
    body: 'Dedicated search surface coming in the next iteration. For now, use the search box at the top of Recent — it searches semantically across your whole corpus.',
  },
  add: {
    title: 'Add files',
    body: 'File ingestion flow coming next: pick a file from disk, Geniuz reads it, summarizes it into a memory, indexes it. Available in a follow-up iteration.',
  },
  detail: {
    title: 'Memory detail',
    body: 'Single-memory detail view is being built. For now, your memories are visible in Recent with full gist + threading.',
  },
  status: {
    title: 'Status',
    body: 'Connection status, MCP server health, embedding model info — coming next.',
  },
  data: {
    title: 'Data & export',
    body: 'Export your corpus, view raw memory.db, migrate to other locations — coming next.',
  },
  settings: {
    title: 'Settings',
    body: 'Model selection, data directory, ingestion preferences — coming next.',
  },
};

export async function mount(container, surfaceId) {
  const info = COPY[surfaceId] || { title: surfaceId, body: 'This surface is not implemented yet.' };
  container.innerHTML = `
    <main class="main">
      <header class="main-header">
        <div>
          <h1>${info.title}</h1>
          <p class="mh-sub">Geniuz · v2.0.0</p>
        </div>
      </header>
      <div class="main-body" style="display:block;">
        <div class="empty-state" style="max-width:560px;margin:48px auto;text-align:left;">
          <p style="font-size:15px;line-height:1.6;color:var(--color-ink-secondary);">
            ${info.body}
          </p>
          <p style="font-size:13px;color:var(--color-ink-quaternary);margin-top:24px;">
            Click <strong>Recent</strong> in the sidebar to return to the dashboard.
          </p>
        </div>
      </div>
    </main>
  `;
}
