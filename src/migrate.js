import mysql from "mysql2/promise";
import config from "../config.js";
import { readFile } from "node:fs/promises";
const db = await mysql.createConnection({
  ...config.mysql,
  multipleStatements: true,
});
try {
  const [[lock]] = await db.query(
    "SELECT GET_LOCK('cosmicdesk_migrate',30) acquired",
  );
  if (!lock.acquired) throw new Error("Migration lock unavailable");
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
  );
  for (const version of ["001_attachments.sql", "002_helpdesk.sql"]) {
    const [rows] = await db.execute(
      "SELECT version FROM schema_migrations WHERE version=?",
      [version],
    );
    if (rows.length) continue;
    await db.query(
      await readFile(
        new URL("../migrations/" + version, import.meta.url),
        "utf8",
      ),
    );
    await db.execute("INSERT INTO schema_migrations(version) VALUES (?)", [
      version,
    ]);
    console.log("Applied " + version);
  }
} finally {
  await db.end();
}
