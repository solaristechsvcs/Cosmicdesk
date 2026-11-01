import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
const config = {
  sessionSecret: "test-secret-that-is-long-enough-for-tests",
  secureCookies: false,
};
const pool = {
  execute: async (sql) => {
    if (sql.includes("FROM settings"))
      return [
        [
          {
            setting_key: "welcome_message",
            setting_value: "<script>bad()</script>",
          },
          { setting_key: "allow_guests", setting_value: "1" },
        ],
      ];
    if (sql === "SELECT 1") return [[{ ok: 1 }]];
    return [[]];
  },
};
test("public pages escape settings, set security headers, and provide CSRF forms", async () => {
  const app = createApp({ config, pool });
  const home = await request(app).get("/").expect(200);
  assert.ok(home.text.includes("&lt;script&gt;"));
  assert.equal(home.headers["referrer-policy"], "no-referrer");
  assert.ok(
    home.headers["content-security-policy"].includes("frame-ancestors 'none'"),
  );
  const login = await request(app).get("/login").expect(200);
  assert.match(login.text, /name="_csrf" value="[a-f0-9]{48}"/);
});
test("writes require CSRF; guest cannot reach staff or admin controls", async () => {
  const app = createApp({ config, pool });
  await request(app)
    .post("/tickets/new")
    .type("form")
    .send({ subject: "test" })
    .expect(403);
  for (const path of [
    "/admin",
    "/admin/users",
    "/admin/topics",
    "/admin/settings",
    "/admin/audit",
  ])
    await request(app).get(path).expect(403);
});
test("invalid object fields fail before route execution", async () => {
  await request(createApp({ config, pool }))
    .post("/login")
    .send({ email: { bad: true } })
    .expect(400);
});
