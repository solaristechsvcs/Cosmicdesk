import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import { hash } from "../src/access.js";

const originalBytes = Buffer.from("original attachment bytes");
function appFor(filename, internal_note = 0) {
  const pool = {
    execute: async (sql) => {
      if (sql.includes("FROM settings"))
        return [[{ setting_key: "desk_name", setting_value: "CosmicDesk" }]];
      if (sql.includes("FROM tickets"))
        return [[{ id: 1, guest_token_hash: hash("private-link") }]];
      if (sql.includes("FROM ticket_attachments"))
        return [[{ filename, data: originalBytes, internal_note }]];
      return [[]];
    },
  };
  return createApp({
    config: {
      sessionSecret: "test-secret-at-least-thirty-two-characters",
      secureCookies: false,
    },
    pool,
  });
}
function downloadedName(header) {
  const extended = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (extended) return decodeURIComponent(extended[1]);
  return header
    .match(/filename="((?:\\.|[^"\\])*)"/)[1]
    .replace(/\\(.)/g, "$1");
}
test("attachment responses preserve names, extensions, Unicode and original bytes", async () => {
  for (const filename of [
    "invoice.pdf",
    "screen shot.png",
    "diagnostic.log.txt",
    "résumé.pdf",
    "Support 🚀.txt",
    'customer "notes".txt',
  ]) {
    const response = await request(appFor(filename))
      .get("/tickets/1/attachments/2?token=private-link")
      .expect(200);
    assert.equal(
      downloadedName(response.headers["content-disposition"]),
      filename,
    );
    assert.match(response.headers["content-disposition"], /^attachment;/);
    assert.deepEqual(response.body, originalBytes);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
  }
});
test("stored paths and control characters cannot enter download headers", async () => {
  const response = await request(appFor("C:\\uploads\\report\r\n.pdf"))
    .get("/tickets/1/attachments/2?token=private-link")
    .expect(200);
  assert.equal(
    downloadedName(response.headers["content-disposition"]),
    "report.pdf",
  );
});
test("filename fix retains guest authorization and internal-note privacy", async () => {
  await request(appFor("private.pdf"))
    .get("/tickets/1/attachments/2?token=wrong")
    .expect(403);
  await request(appFor("private.pdf", 1))
    .get("/tickets/1/attachments/2?token=private-link")
    .expect(404);
});
