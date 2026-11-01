import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { migrate } from "../src/migrations.js";

test(
  "recover helpdesk DDL without losing data or broadening staff access",
  { skip: process.env.TEST_MYSQL !== "1" },
  async () => {
    const db = await mysql.createConnection({
      host: "127.0.0.1",
      user: "root",
      password: "testroot",
      multipleStatements: true,
    });
    const database = "cosmicdesk_recovery_" + process.pid;
    assert.match(database, /^cosmicdesk_recovery_\d+$/);
    try {
      await db.query("CREATE DATABASE `" + database + "`");
      await db.query("USE `" + database + "`");
      await db.query(
        await readFile(new URL("../schema.sql", import.meta.url), "utf8"),
      );
      await db.query(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES (1,'Agent','agent@example.com','placeholder','staff'); INSERT INTO tickets(id,subject,department_id,guest_name,guest_email,guest_token_hash) VALUES (1,'Preserve old ticket',1,'Guest','guest@example.com',REPEAT('a',64)); INSERT INTO ticket_messages(id,ticket_id,author_name,body) VALUES (1,1,'Guest','Keep this message'); INSERT INTO ticket_attachments(message_id,filename,mime_type,file_size,data) VALUES (1,'keep.txt','text/plain',4,'keep')",
      );
      // Reproduce an interrupted/manual upgrade: column exists, no migration ledger row.
      await db.query(
        "ALTER TABLE tickets ADD COLUMN help_topic_id INT UNSIGNED NULL",
      );
      await migrate(db, { log: () => {} });
      const [[ticket]] = await db.query("SELECT * FROM tickets WHERE id=1");
      assert.equal(ticket.subject, "Preserve old ticket");
      assert.equal(ticket.guest_token_hash, "a".repeat(64));
      const [[message]] = await db.query(
        "SELECT body FROM ticket_messages WHERE id=1",
      );
      assert.equal(message.body, "Keep this message");
      const [[file]] = await db.query(
        "SELECT data FROM ticket_attachments WHERE message_id=1",
      );
      assert.equal(file.data.toString(), "keep");
      const [[membership]] = await db.query(
        "SELECT COUNT(*) count FROM staff_departments WHERE user_id=1",
      );
      assert.equal(membership.count, 3);
      await migrate(db, { log: () => {} });
      const [[ledger]] = await db.query(
        "SELECT COUNT(*) count FROM schema_migrations",
      );
      assert.equal(ledger.count, 2);
      // Recover fully existing tables whose ledger row was lost; preserve admin choices.
      await db.query(
        "DELETE FROM schema_migrations WHERE version='002_helpdesk.sql'; DELETE FROM staff_departments WHERE department_id!=2; UPDATE settings SET setting_value='My business' WHERE setting_key='desk_name'; UPDATE help_topics SET name='Custom topic' WHERE id=1; ALTER TABLE tickets DROP FOREIGN KEY fk_ticket_topic; DROP INDEX idx_queue ON tickets",
      );
      await migrate(db, { log: () => {} });
      const [restricted] = await db.query(
        "SELECT department_id FROM staff_departments WHERE user_id=1",
      );
      assert.deepEqual(
        restricted.map((r) => r.department_id),
        [2],
      );
      const [[setting]] = await db.query(
        "SELECT setting_value FROM settings WHERE setting_key='desk_name'",
      );
      assert.equal(setting.setting_value, "My business");
      const [[topic]] = await db.query(
        "SELECT name FROM help_topics WHERE id=1",
      );
      assert.equal(topic.name, "Custom topic");
      const [fk] = await db.query(
        "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME='help_topic_id' AND REFERENCED_TABLE_NAME='help_topics'",
      );
      assert.equal(fk.length, 1);
      const [index] = await db.query(
        "SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND INDEX_NAME='idx_queue' ORDER BY SEQ_IN_INDEX",
      );
      assert.deepEqual(
        index.map((r) => r.COLUMN_NAME),
        ["department_id", "status", "updated_at"],
      );
      // Do not hide a real schema conflict or claim the migration succeeded.
      await db.query(
        "DELETE FROM schema_migrations WHERE version='002_helpdesk.sql'; ALTER TABLE tickets DROP FOREIGN KEY fk_ticket_topic; ALTER TABLE tickets MODIFY help_topic_id VARCHAR(20) NULL",
      );
      await assert.rejects(
        migrate(db, { log: () => {} }),
        /must be nullable INT UNSIGNED/,
      );
      const [failed] = await db.query(
        "SELECT version FROM schema_migrations WHERE version='002_helpdesk.sql'",
      );
      assert.equal(failed.length, 0);
    } finally {
      await db.query("DROP DATABASE IF EXISTS `" + database + "`");
      await db.end();
    }
  },
);
