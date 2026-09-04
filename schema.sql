-- Struttura del database D1. Si puo' rilanciare senza rischi.
CREATE TABLE IF NOT EXISTS participants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  answers    TEXT    NOT NULL,   -- JSON: indici delle opzioni scelte
  cluster    INTEGER NOT NULL,
  x          REAL    NOT NULL,   -- coordinate PCA
  y          REAL    NOT NULL,
  ux         REAL    NOT NULL,   -- coordinate UMAP
  uy         REAL    NOT NULL,
  ip_hash    TEXT,               -- hash troncato, solo per il rate limit
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participants_ip ON participants (ip_hash, id);
