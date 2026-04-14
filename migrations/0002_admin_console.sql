CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nav_links (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  href TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  open_in_new_tab INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nav_links_sort_order ON nav_links(sort_order ASC, created_at ASC);

INSERT OR IGNORE INTO nav_links (id, label, href, sort_order, open_in_new_tab, created_at, updated_at)
VALUES
  ('nav-home', '首页', '/', 0, 0, unixepoch() * 1000, unixepoch() * 1000),
  ('nav-about', '关于', '/about', 10, 0, unixepoch() * 1000, unixepoch() * 1000),
  ('nav-ai', 'AI工具', '/ai', 20, 0, unixepoch() * 1000, unixepoch() * 1000);
