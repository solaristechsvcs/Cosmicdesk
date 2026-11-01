import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import request from "supertest";
import { createApp } from "../src/app.js";
const enabled = process.env.TEST_MYSQL === "1";
test(
  "MySQL helpdesk workflow and authorization boundaries",
  { skip: !enabled },
  async () => {
    const pool = mysql.createPool({
      host: "127.0.0.1",
      user: "root",
      password: "testroot",
      database: "cosmicdesk",
      multipleStatements: true,
    });
    try {
      const run = async (sql, args = []) => (await pool.execute(sql, args))[0];
      await pool.query(
        "DELETE FROM ticket_attachments; DELETE FROM ticket_messages; DELETE FROM tickets; DELETE FROM staff_departments; DELETE FROM users;",
      );
      const password = await bcrypt.hash("long-test-password", 4);
      for (const [id, role] of [
        [1, "admin"],
        [2, "staff"],
        [3, "customer"],
        [4, "customer"],
      ])
        await run(
          "INSERT INTO users(id,name,email,password_hash,role) VALUES (?,?,?,?,?)",
          [id, role, role + id + "@example.com", password, role],
        );
      await run("INSERT INTO staff_departments VALUES (2,1)");
      const app = createApp({
        config: {
          sessionSecret: "test-secret-at-least-thirty-two-chars",
          secureCookies: false,
        },
        pool,
      });
      const admin = request.agent(app),
        staff = request.agent(app),
        customer = request.agent(app),
        other = request.agent(app),
        guest = request.agent(app),
        stranger = request.agent(app);
      const token = async (agent, path = "/login") => {
        const r = await agent.get(path).expect(200);
        return r.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
      };
      const post = async (agent, path, data, page = "/login") => {
        const _csrf = await token(agent, page);
        return agent
          .post(path)
          .type("form")
          .send({ _csrf, ...data });
      };
      for (const [agent, email] of [
        [admin, "admin1"],
        [staff, "staff2"],
        [customer, "customer3"],
        [other, "customer4"],
      ]) {
        const r = await post(agent, "/login", {
          email: email + "@example.com",
          password: "long-test-password",
        });
        assert.equal(r.status, 302);
      }
      const fields = {
        subject: "Printer <offline>",
        message: "Please help",
        priority: "normal",
        help_topic_id: "1",
      };
      const created = await post(customer, "/tickets/new", fields);
      assert.equal(created.status, 302);
      const path = created.headers.location;
      assert.ok(
        (await customer.get(path).expect(200)).text.includes(
          "Printer &lt;offline&gt;",
        ),
      );
      await other.get(path).expect(404);
      await stranger.get(path).expect(404);
      const guestResult = await post(guest, "/tickets/new", {
        ...fields,
        name: "Guest",
        email: "guest@example.com",
      });
      assert.equal(guestResult.status, 200);
      const guestLink = guestResult.text.match(
        /href="(\/tickets\/\d+\?token=[a-f0-9]+)"/,
      )[1];
      await stranger.get(guestLink).expect(200);
      await stranger
        .get(guestLink.replace(/token=.*/, "token=wrong"))
        .expect(404);
      const staffCsrf = await token(staff);
      await staff
        .post(path + "/reply")
        .field("_csrf", staffCsrf)
        .field("body", "Private investigation")
        .field("internal_note", "1")
        .attach("attachment", Buffer.from("private file"), {
          filename: "private.txt",
          contentType: "text/plain",
        })
        .expect(302);
      const staffView = await staff.get(path).expect(200);
      assert.ok(staffView.text.includes("Private investigation"));
      const customerView = await customer.get(path).expect(200);
      assert.ok(!customerView.text.includes("Private investigation"));
      assert.ok(!customerView.text.includes("private.txt"));
      const attachment = staffView.text.match(
        /href="([^\"]+\/attachments\/\d+)"/,
      )[1];
      await customer.get(attachment).expect(404);
      const download = await staff.get(attachment).expect(200);
      assert.match(
        download.headers["content-disposition"],
        /filename="private\.txt"/,
      );
      assert.equal(download.body.toString(), "private file");
      assert.equal(
        (await post(staff, path + "/assign", { staff_id: "2" })).status,
        302,
      );
      assert.equal(
        (await post(staff, path + "/status", { status: "pending" })).status,
        302,
      );
      assert.ok(
        (await staff.get("/tickets?queue=mine").expect(200)).text.includes(
          "Printer &lt;offline&gt;",
        ),
      );
      const hidden = await post(customer, "/tickets/new", {
        ...fields,
        help_topic_id: "2",
      });
      await staff.get(hidden.headers.location).expect(404);
      assert.equal(
        (
          await post(staff, hidden.headers.location + "/status", {
            status: "closed",
          })
        ).status,
        404,
      );
      await staff.get("/admin/settings").expect(403);
      assert.equal(
        (
          await post(admin, "/admin/settings", {
            desk_name: "Orbital Support",
            welcome_message: "Welcome aboard",
            allow_guests: "0",
          })
        ).status,
        302,
      );
      assert.equal(
        (
          await post(guest, "/tickets/new", {
            ...fields,
            name: "Guest",
            email: "guest@example.com",
          })
        ).status,
        403,
      );
      assert.equal(
        (await post(admin, "/admin/users/2/departments", {})).status,
        302,
      );
      await staff.get(path).expect(404);
      assert.equal(
        (await post(admin, "/admin/users/1/role", { role: "customer" })).status,
        400,
      );
      assert.equal(
        (
          await post(admin, "/admin/topics", {
            name: "Network",
            department_id: "3",
            active: "1",
          })
        ).status,
        302,
      );
      assert.equal(
        (await post(admin, "/admin/departments", { name: "Operations" }))
          .status,
        302,
      );
      await admin.get("/admin/audit").expect(200);
      assert.equal(
        (await post(admin, path + "/status", { status: "closed" })).status,
        302,
      );
      assert.equal(
        (await post(customer, path + "/reply", { body: "reopen?" })).status,
        400,
      );
      assert.equal(
        (
          await post(admin, path + "/routing", {
            department_id: "3",
            priority: "urgent",
          })
        ).status,
        302,
      );
      const [[routed]] = await pool.query(
        "SELECT department_id,priority,assigned_to FROM tickets WHERE id=?",
        [path.split("/").pop()],
      );
      assert.equal(routed.department_id, 3);
      assert.equal(routed.priority, "urgent");
      assert.equal(routed.assigned_to, null);
      const [[counts]] = await pool.query("SELECT COUNT(*) count FROM tickets");
      assert.equal(counts.count, 3);
    } finally {
      await pool.end();
    }
  },
);
