import { readFile } from "node:fs/promises";

/** Resume the known helpdesk DDL using metadata, rather than ignoring duplicate SQL errors. */
export async function applyHelpdesk(db) {
  const [existingMembership] = await db.execute(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='staff_departments'",
  );
  await db.query(
    await readFile(
      new URL("../migrations/002_helpdesk.sql", import.meta.url),
      "utf8",
    ),
  );
  const [columns] = await db.execute(
    "SELECT COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='help_topic_id'",
  );
  if (!columns.length)
    await db.query(
      "ALTER TABLE tickets ADD COLUMN help_topic_id INT UNSIGNED NULL",
    );
  else if (
    !/^int(?:\(\d+\))? unsigned$/i.test(columns[0].COLUMN_TYPE) ||
    columns[0].IS_NULLABLE !== "YES"
  )
    throw new Error(
      "Existing tickets.help_topic_id must be nullable INT UNSIGNED. Migration stopped without marking completion.",
    );
  const [foreignKeys] = await db.execute(
    "SELECT CONSTRAINT_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='help_topic_id' AND REFERENCED_TABLE_NAME IS NOT NULL",
  );
  if (
    foreignKeys.some(
      (key) =>
        key.REFERENCED_TABLE_NAME !== "help_topics" ||
        key.REFERENCED_COLUMN_NAME !== "id",
    )
  )
    throw new Error(
      "Existing help_topic_id foreign key points to an unexpected table. Migration stopped.",
    );
  if (!foreignKeys.length)
    await db.query(
      "ALTER TABLE tickets ADD CONSTRAINT fk_ticket_topic FOREIGN KEY (help_topic_id) REFERENCES help_topics(id)",
    );
  const [indexes] = await db.execute(
    "SELECT COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND INDEX_NAME='idx_queue' ORDER BY SEQ_IN_INDEX",
  );
  if (!indexes.length)
    await db.query(
      "CREATE INDEX idx_queue ON tickets(department_id,status,updated_at)",
    );
  else if (
    indexes.map((i) => i.COLUMN_NAME).join(",") !==
    "department_id,status,updated_at"
  )
    throw new Error(
      "Existing idx_queue index has unexpected columns. Migration stopped.",
    );
  // Never widen existing membership during recovery. An admin can fill missing memberships.
  if (!existingMembership.length)
    await db.query(
      "INSERT IGNORE INTO staff_departments SELECT u.id,d.id FROM users u CROSS JOIN departments d WHERE u.role IN ('staff','admin')",
    );
}

export async function migrate(db, { log = console.log } = {}) {
  const [[lock]] = await db.query(
    "SELECT GET_LOCK('cosmicdesk_migrate',30) acquired",
  );
  if (!lock.acquired) throw new Error("Migration lock unavailable");
  try {
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
    );
    for (const version of ["001_attachments.sql", "002_helpdesk.sql"]) {
      const [rows] = await db.execute(
        "SELECT version FROM schema_migrations WHERE version=?",
        [version],
      );
      if (rows.length) continue;
      if (version === "002_helpdesk.sql") await applyHelpdesk(db);
      else
        await db.query(
          await readFile(
            new URL("../migrations/" + version, import.meta.url),
            "utf8",
          ),
        );
      await db.execute("INSERT INTO schema_migrations(version) VALUES (?)", [
        version,
      ]);
      log("Applied " + version);
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('cosmicdesk_migrate')");
  }
}
