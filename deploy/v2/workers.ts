// Stand-in for the `cloudflare:workers` module when Priolab runs as a Node
// server on APP-01 instead of on Sites. adapt.mjs points the app's imports
// here at build time; the source in sites-secure/ keeps importing
// `cloudflare:workers` so it still deploys to Sites unchanged.
//
// `env.DB` is a D1-compatible facade over one SQLite file (node:sqlite), with
// the surface the app uses: prepare().bind().first()/all()/run(). D1 is
// SQLite underneath, so every query the app writes runs as-is.
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Param = string | number | bigint | null | Uint8Array;

class Statement {
  constructor(private db: DatabaseSync, private sql: string, private params: Param[] = []) {}
  bind(...params: Param[]) { return new Statement(this.db, this.sql, params); }
  private stmt(): StatementSync { return this.db.prepare(this.sql); }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.stmt().get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }
  async all<T = Record<string, unknown>>() {
    const rows = this.stmt().all(...this.params) as Record<string, unknown>[];
    return { results: rows.map(row => ({ ...row })) as T[], success: true, meta: {} };
  }
  async run() {
    const result = this.stmt().run(...this.params);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

class Database {
  constructor(private db: DatabaseSync) {}
  prepare(sql: string) { return new Statement(this.db, sql); }
  async batch(statements: Statement[]) {
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const s of statements) out.push(await s.run());
      this.db.exec("COMMIT");
      return out;
    } catch (cause) { this.db.exec("ROLLBACK"); throw cause; }
  }
  async exec(sql: string) { this.db.exec(sql); return { count: 0, duration: 0 }; }
}

// Drizzle migrations from sites-secure/drizzle, each applied once, in order,
// inside a transaction. The ledger table is ours; the app never reads it.
function migrate(db: DatabaseSync, dir: string) {
  db.exec("CREATE TABLE IF NOT EXISTS _platform_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set((db.prepare("SELECT name FROM _platform_migrations").all() as { name: string }[]).map(r => r.name));
  for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    db.exec("BEGIN");
    try {
      for (const part of sql.split("--> statement-breakpoint")) if (part.trim()) db.exec(part);
      db.prepare("INSERT INTO _platform_migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
      db.exec("COMMIT");
      console.log(`[platform] migration applied: ${file}`);
    } catch (cause) { db.exec("ROLLBACK"); throw cause; }
  }
}

let opened: Database | undefined;
function openDatabase(): Database {
  if (opened) return opened;
  const file = process.env.PRIOLAB_DB_PATH || "/data/priolab.sqlite";
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db, process.env.PRIOLAB_MIGRATIONS || path.join(process.cwd(), "drizzle"));
  opened = new Database(db);
  return opened;
}

export const env = {
  get DB() { return openDatabase() as unknown as D1Database; },
  get APP_ENCRYPTION_KEY() { return process.env.APP_ENCRYPTION_KEY; },
};

export class WorkerEntrypoint {}
