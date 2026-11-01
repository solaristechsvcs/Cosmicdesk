import { csrf, staff, hash, canAccess } from "./access.js";
import {
  esc,
  field,
  form,
  page,
  badge,
  dateLabel,
  ticketTable,
} from "./views.js";
import express from "express";
import session from "express-session";

import bcrypt from "bcryptjs";
import crypto from "node:crypto";

import multer from "multer";

export function createApp({ config, pool, store }) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 20, parts: 21 },
    fileFilter: (req, file, cb) =>
      [
        "image/png",
        "image/jpeg",
        "image/webp",
        "application/pdf",
        "text/plain",
      ].includes(file.mimetype)
        ? cb(null, true)
        : cb(new Error("Unsupported attachment type")),
  });
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy || false);
  app.use((req, res, next) => {
    res.set({
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    next();
  });
  const attempts = new Map();
  app.use((req, res, next) => {
    if (req.method !== "POST") return next();
    const key = req.ip + ":" + (req.path === "/login" ? "login" : "write");
    const now = Date.now();
    if (attempts.size > 10000)
      for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const item = attempts.get(key);
    const bucket =
      item && item.until > now ? item : { count: 0, until: now + 900000 };
    attempts.set(key, bucket);
    if (++bucket.count > (req.path === "/login" ? 30 : 120))
      return res
        .status(429)
        .send("Too many requests. Try again in 15 minutes.");
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.use(express.json({ limit: "64kb" }));
  app.use((req, res, next) =>
    req.is("multipart/form-data")
      ? upload.single("attachment")(req, res, next)
      : next(),
  );
  app.use((req, res, next) => {
    if (
      Object.entries(req.body || {}).some(
        ([key, value]) => key !== "departments" && typeof value !== "string",
      )
    )
      return res.status(400).send("Invalid form fields");
    next();
  });
  app.use(
    session({
      name: "cosmicdesk.sid",
      secret: config.sessionSecret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.secureCookies ?? process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 86400000,
      },
    }),
  );
  app.use(express.static("public"));
  app.use(async (req, res, next) => {
    try {
      if (req.session.user) {
        const [user] = (
          await pool.execute("SELECT id,name,role FROM users WHERE id=?", [
            req.session.user.id,
          ])
        )[0];
        if (!user) {
          return req.session.destroy(() =>
            res.status(401).send("Account unavailable"),
          );
        }
        req.session.user = { id: user.id, name: user.name, role: user.role };
      }
      next();
    } catch (e) {
      next(e);
    }
  });
  const q = async (sql, params = []) => (await pool.execute(sql, params))[0];
  const clean = (s) => String(s ?? "").trim();
  app.use((req, res, next) => {
    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      req.method !== "OPTIONS" &&
      req.body?._csrf !== csrf(req)
    )
      return res.status(403).send("Invalid form token");
    next();
  });
  const fail = (res, req, msg, status = 400) =>
    res
      .status(status)
      .send(
        page(req, "Request error", `<p>${esc(msg)}</p><a href="/">Home</a>`),
      );
  const requireStaff = (req, res, next) =>
    staff(req) ? next() : fail(res, req, "Staff access required", 403);
  const requireAdmin = (req, res, next) =>
    req.session.user?.role === "admin"
      ? next()
      : fail(res, req, "Administrator access required", 403);
  const attachmentField =
    '<label>Attachment (PNG, JPEG, WebP, PDF or text; max 5 MB)<input type="file" name="attachment" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt"></label>';
  const saveAttachment = async (conn, messageId, file) => {
    if (!file) return;
    await conn.execute(
      "INSERT INTO ticket_attachments (message_id,filename,mime_type,file_size,data) VALUES (?,?,?,?,?)",
      [
        messageId,
        file.originalname.slice(0, 200),
        file.mimetype,
        file.size,
        file.buffer,
      ],
    );
  };
  const route = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next);
  const statuses = ["open", "pending", "closed"],
    priorities = ["low", "normal", "high", "urgent"];
  app.use((req, res, next) => {
    Promise.resolve()
      .then(async () => {
        req.departmentIds = staff(req)
          ? (
              await q(
                "SELECT department_id FROM staff_departments WHERE user_id=?",
                [req.session.user.id],
              )
            ).map((r) => String(r.department_id))
          : [];
        req.settings = Object.fromEntries(
          (await q("SELECT setting_key,setting_value FROM settings")).map(
            (r) => [r.setting_key, r.setting_value],
          ),
        );
        next();
      })
      .catch(next);
  });

  app.get(
    "/health",
    route(async (req, res) => {
      await q("SELECT 1");
      res.json({ ok: true });
    }),
  );
  app.get("/", (req, res) =>
    res.send(
      page(
        req,
        "Support that reaches further",
        `<p>${esc(req.settings.welcome_message)}</p>` +
          '<section class="hero"><p>Open a support request as a guest or create an account to track every conversation.</p><a class="button" href="/tickets/new">Open a ticket</a> <a class="button secondary" href="/tickets">My tickets</a></section>',
      ),
    ),
  );
  app.get("/register", (req, res) =>
    res.send(
      page(
        req,
        "Create account",
        form(
          req,
          "/register",
          field("Name", "name") +
            field("Email", "email", "email") +
            field("Password (12–72 characters)", "password", "password"),
        ),
      ),
    ),
  );
  app.post(
    "/register",
    route(async (req, res) => {
      const { name, email, password } = req.body;
      if (
        clean(name).length < 2 ||
        !/^\S+@\S+\.\S+$/.test(clean(email)) ||
        String(password || "").length < 12 ||
        Buffer.byteLength(String(password || ""), "utf8") > 72 ||
        clean(name).length > 120 ||
        clean(email).length > 255
      )
        return fail(
          res,
          req,
          "Provide a valid name, email and password of 12–72 characters",
        );
      try {
        await q("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)", [
          clean(name),
          clean(email).toLowerCase(),
          await bcrypt.hash(password, 12),
        ]);
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY")
          return fail(res, req, "Email already registered");
        throw e;
      }
      res.redirect("/login");
    }),
  );
  app.get("/login", (req, res) =>
    res.send(
      page(
        req,
        "Login",
        form(
          req,
          "/login",
          field("Email", "email", "email") +
            field("Password", "password", "password"),
        ),
      ),
    ),
  );
  app.post(
    "/login",
    route(async (req, res) => {
      const [user] = await q(
        "SELECT id,name,email,password_hash,role FROM users WHERE email=?",
        [clean(req.body.email).toLowerCase()],
      );
      if (
        !user ||
        !(await bcrypt.compare(
          String(req.body.password || ""),
          user.password_hash,
        ))
      )
        return fail(res, req, "Invalid credentials", 401);
      req.session.regenerate((err) => {
        if (err) return res.status(500).send("Session error");
        req.session.user = { id: user.id, name: user.name, role: user.role };
        res.redirect("/tickets");
      });
    }),
  );
  app.post("/logout", (req, res) =>
    req.session.destroy(() => res.redirect("/")),
  );
  app.get(
    "/tickets/new",
    route(async (req, res) => {
      const topics = await q(
        "SELECT id,name FROM help_topics WHERE active=1 ORDER BY name",
      );
      res.send(
        page(
          req,
          "Open a ticket",
          form(
            req,
            "/tickets/new",
            (req.session.user
              ? ""
              : field("Your name", "name") +
                field("Your email", "email", "email")) +
              field("Subject", "subject") +
              `<label>Help topic<select name="help_topic_id">${topics.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select></label><label>Priority<select name="priority">${priorities.map((p) => `<option>${p}</option>`).join("")}</select></label><label>Message<textarea name="message" required maxlength="10000"></textarea></label>${attachmentField}`,
            true,
          ),
        ),
      );
    }),
  );
  app.post(
    "/tickets/new",
    route(async (req, res) => {
      const { subject, message, priority, help_topic_id } = req.body;
      if (!req.session.user && req.settings.allow_guests !== "1")
        return fail(res, req, "Guest submissions are disabled", 403);
      const [topic] = await q(
        "SELECT * FROM help_topics WHERE id=? AND active=1",
        [help_topic_id || 0],
      );
      if (!topic) return fail(res, req, "Select an active help topic");
      const department_id = topic.department_id;
      const name = req.session.user?.name || clean(req.body.name),
        email = req.session.user ? null : clean(req.body.email).toLowerCase();
      if (
        clean(subject).length > 200 ||
        clean(message).length > 10000 ||
        name.length > 120 ||
        (email && email.length > 255) ||
        !clean(subject) ||
        !clean(message) ||
        !priorities.includes(priority) ||
        (!req.session.user && (!name || !/^\S+@\S+\.\S+$/.test(email)))
      )
        return fail(res, req, "Complete all ticket fields");
      const departments = await q("SELECT id FROM departments WHERE id=?", [
        department_id,
      ]);
      if (!departments.length) return fail(res, req, "Invalid department");
      const token = req.session.user
        ? null
        : crypto.randomBytes(32).toString("hex");
      const conn = await pool.getConnection();
      let id;
      try {
        await conn.beginTransaction();
        const [r] = await conn.execute(
          "INSERT INTO tickets (subject,department_id,priority,customer_id,guest_name,guest_email,guest_token_hash,help_topic_id) VALUES (?,?,?,?,?,?,?,?)",
          [
            clean(subject).slice(0, 200),
            department_id,
            priority,
            req.session.user?.id || null,
            req.session.user ? null : name,
            email,
            token ? hash(token) : null,
            topic.id,
          ],
        );
        id = r.insertId;
        const [m] = await conn.execute(
          "INSERT INTO ticket_messages (ticket_id,author_id,author_name,body) VALUES (?,?,?,?)",
          [id, req.session.user?.id || null, name, clean(message)],
        );
        await saveAttachment(conn, m.insertId, req.file);
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
      if (token) {
        req.session.guestTickets = { ...req.session.guestTickets, [id]: token };
        return res.send(
          page(
            req,
            "Ticket created",
            `<p>Ticket #${id} created. Save this private access link: it is the only way to access this guest ticket from another browser.</p><p class="secret"><a href="/tickets/${id}?token=${token}">Open ticket #${id}</a></p><p>Guest access links are not emailed in this initial release.</p>`,
          ),
        );
      }
      res.redirect("/tickets/" + id);
    }),
  );
  app.get(
    "/tickets",
    route(async (req, res) => {
      if (!req.session.user)
        return res.send(
          page(
            req,
            "Track a ticket",
            '<p>Sign in to view your tickets, or use your saved private guest link.</p><a href="/login">Sign in</a>',
          ),
        );
      const clauses = [],
        params = [];
      const isStaff = staff(req);
      if (!isStaff) {
        clauses.push("t.customer_id=?");
        params.push(req.session.user.id);
      } else if (req.session.user.role !== "admin") {
        clauses.push(
          "t.department_id IN (SELECT department_id FROM staff_departments WHERE user_id=?)",
        );
        params.push(req.session.user.id);
      }
      const queue = String(req.query.queue || "open");
      if (isStaff) {
        if (queue === "mine") {
          clauses.push("t.assigned_to=?");
          params.push(req.session.user.id);
        } else if (queue === "unassigned")
          clauses.push('t.assigned_to IS NULL AND t.status!="closed"');
        else if (statuses.includes(queue)) {
          clauses.push("t.status=?");
          params.push(queue);
        }
      }
      if (req.query.search) {
        clauses.push("(t.subject LIKE ? OR CAST(t.id AS CHAR)=?)");
        params.push(
          "%" + String(req.query.search).slice(0, 200) + "%",
          String(req.query.search),
        );
      }
      const pageNo = Math.max(
        1,
        Math.min(100000, parseInt(req.query.page) || 1),
      );
      const rows = await q(
        "SELECT t.*,d.name department,u.name assignee FROM tickets t JOIN departments d ON d.id=t.department_id LEFT JOIN users u ON u.id=t.assigned_to " +
          (clauses.length ? "WHERE " + clauses.join(" AND ") : "") +
          " ORDER BY t.updated_at DESC,t.id DESC LIMIT 51 OFFSET " +
          (pageNo - 1) * 50,
        params,
      );

      const queueNames = {
        open: "Open tickets",
        pending: "Pending tickets",
        closed: "Closed tickets",
        mine: "Assigned to me",
        unassigned: "Unassigned tickets",
        all: "All tickets",
      };
      const nav =
        '<div class="queue-heading"><h2>' +
        esc(isStaff ? queueNames[queue] || "All tickets" : "Your requests") +
        '</h2><span class="result-count">' +
        rows.slice(0, 50).length +
        " shown · Page " +
        pageNo +
        "</span></div>";
      const search =
        '<form class="queue-search" method="get"><input type="hidden" name="queue" value="' +
        esc(queue) +
        '"><label for="ticket-search">Search tickets</label><input id="ticket-search" name="search" placeholder="Subject or ticket number" value="' +
        esc(req.query.search || "") +
        '"><button>Search</button></form>';
      res.send(
        page(
          req,
          isStaff ? "Ticket workspace" : "My tickets",
          nav +
            search +
            ticketTable(rows.slice(0, 50)) +
            '<nav class="pagination" aria-label="Ticket pages">' +
            (pageNo > 1
              ? '<a href="?queue=' +
                encodeURIComponent(queue) +
                "&search=" +
                encodeURIComponent(req.query.search || "") +
                "&page=" +
                (pageNo - 1) +
                '">Previous</a>'
              : "") +
            (rows.length > 50
              ? '<a href="?queue=' +
                encodeURIComponent(queue) +
                "&search=" +
                encodeURIComponent(req.query.search || "") +
                "&page=" +
                (pageNo + 1) +
                '">Next</a>'
              : "") +
            "</nav>",
        ),
      );
    }),
  );
  app.get(
    "/tickets/:id",
    route(async (req, res) => {
      const [t] = await q(
        "SELECT t.*,d.name department FROM tickets t JOIN departments d ON d.id=t.department_id WHERE t.id=?",
        [req.params.id],
      );
      if (!t || !canAccess(req, t))
        return fail(res, req, "Ticket not found or access denied", 404);
      const token = req.query.token || req.session.guestTickets?.[t.id] || "";
      const queryToken = token ? "?token=" + encodeURIComponent(token) : "";
      const messages = await q(
        "SELECT * FROM ticket_messages WHERE ticket_id=? AND (internal_note=0 OR ?=1) ORDER BY created_at,id",
        [t.id, staff(req) ? 1 : 0],
      );
      const attachments = await q(
        "SELECT a.id,a.message_id,a.filename FROM ticket_attachments a JOIN ticket_messages m ON m.id=a.message_id WHERE m.ticket_id=? AND (m.internal_note=0 OR ?=1)",
        [t.id, staff(req) ? 1 : 0],
      );
      let body =
        `<section class="ticket-summary" aria-label="Ticket details"><div><span>Ticket number</span><strong>#${t.id}</strong></div><div><span>Status</span>${badge(t.status)}</div><div><span>Priority</span>${badge(t.priority, "priority")}</div><div><span>Department</span><strong>${esc(t.department)}</strong></div></section><div class="ticket-layout"><section class="conversation"><h2>Conversation</h2>` +
        messages
          .map(
            (m) =>
              `<article class="thread-message ${m.internal_note ? "internal-note" : ""}"><div class="message-heading"><strong>${esc(m.author_name)}</strong><span>${m.internal_note ? "Internal note · Staff only" : "Public message"}</span></div><p class="message">${esc(m.body)}</p>${attachments
                .filter((a) => String(a.message_id) === String(m.id))
                .map(
                  (a) =>
                    `<p><a href="/tickets/${t.id}/attachments/${a.id}${queryToken}">📎 ${esc(a.filename)}</a></p>`,
                )
                .join(
                  "",
                )}<small>${esc(dateLabel(m.created_at))}</small></article>`,
          )
          .join("");
      if (t.status !== "closed" || staff(req))
        body += form(
          req,
          "/tickets/" + t.id + "/reply",
          `<input type="hidden" name="token" value="${esc(token)}"><label>Reply<textarea name="body" maxlength="10000" required></textarea></label>${attachmentField}${staff(req) ? '<label><input type="checkbox" name="internal_note" value="1"> Internal note (staff only)</label>' : ""}`,
          true,
        );
      body +=
        '</section><aside class="ticket-actions"><h2>Ticket properties</h2>';
      if (staff(req)) {
        const agents = await q(
          "SELECT u.id,u.name FROM users u WHERE u.role='admin' OR (u.role='staff' AND EXISTS (SELECT 1 FROM staff_departments sd WHERE sd.user_id=u.id AND sd.department_id=?)) ORDER BY u.name",
          [t.department_id],
        );
        body += form(
          req,
          "/tickets/" + t.id + "/assign",
          `<label>Assign to<select name="staff_id"><option value="">Unassigned</option>${agents.map((a) => `<option value="${a.id}" ${String(t.assigned_to) === String(a.id) ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>`,
        );
      }
      if (staff(req))
        body += form(
          req,
          "/tickets/" + t.id + "/status",
          `<input type="hidden" name="token" value="${esc(token)}"><label>Status<select name="status">${statuses.map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>`,
        );

      if (staff(req)) {
        const departments = await q(
          "SELECT id,name FROM departments ORDER BY name",
        );
        body += form(
          req,
          "/tickets/" + t.id + "/routing",
          '<label>Transfer to department<select name="department_id">' +
            departments
              .map(
                (d) =>
                  '<option value="' +
                  d.id +
                  '" ' +
                  (String(d.id) === String(t.department_id) ? "selected" : "") +
                  ">" +
                  esc(d.name) +
                  "</option>",
              )
              .join("") +
            '</select></label><label>Priority<select name="priority">' +
            priorities
              .map(
                (p) =>
                  "<option " +
                  (p === t.priority ? "selected" : "") +
                  ">" +
                  p +
                  "</option>",
              )
              .join("") +
            "</select></label><p>Changing department clears the current assignment.</p>",
        );
      }
      res.send(
        page(
          req,
          "Ticket #" + t.id + " · " + t.subject,
          body +
            `</aside></div><p><a href="/tickets">← Back to tickets</a></p>`,
        ),
      );
    }),
  );
  app.post(
    "/tickets/:id/reply",
    route(async (req, res) => {
      const [t] = await q("SELECT * FROM tickets WHERE id=?", [req.params.id]);
      if (!t || !canAccess(req, t)) return fail(res, req, "Access denied", 403);
      if (t.status === "closed" && !staff(req))
        return fail(res, req, "Ticket is closed");
      const body = clean(req.body.body);
      if (!body || body.length > 10000)
        return fail(res, req, "Invalid message");
      const internal = staff(req) && req.body.internal_note === "1" ? 1 : 0;
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [m] = await conn.execute(
          "INSERT INTO ticket_messages (ticket_id,author_id,author_name,body,internal_note) VALUES (?,?,?,?,?)",
          [
            t.id,
            req.session.user?.id || null,
            req.session.user?.name || t.guest_name,
            body,
            internal,
          ],
        );
        await saveAttachment(conn, m.insertId, req.file);
        await conn.execute("UPDATE tickets SET updated_at=NOW() WHERE id=?", [
          t.id,
        ]);
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
      res.redirect(
        "/tickets/" +
          t.id +
          (req.body.token
            ? "?token=" + encodeURIComponent(req.body.token)
            : ""),
      );
    }),
  );
  app.get(
    "/tickets/:id/attachments/:attachmentId",
    route(async (req, res) => {
      const [t] = await q("SELECT * FROM tickets WHERE id=?", [req.params.id]);
      if (!t || !canAccess(req, t)) return fail(res, req, "Access denied", 403);
      const [a] = await q(
        "SELECT a.*,m.internal_note FROM ticket_attachments a JOIN ticket_messages m ON m.id=a.message_id WHERE a.id=? AND m.ticket_id=?",
        [req.params.attachmentId, t.id],
      );
      if (!a || (a.internal_note && !staff(req)))
        return fail(res, req, "Attachment not found", 404);
      const filename =
        String(a.filename || "attachment")
          .replaceAll("\\", "/")
          .split("/")
          .pop()
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .trim() || "attachment";
      // ASCII fallback plus RFC 5987 UTF-8 name keeps extensions and non-English names.
      res.attachment(filename.replace(/[^\x20-\x7e]/g, "_"));
      const encodedName = encodeURIComponent(filename).replace(
        /[!'()*]/g,
        (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
      );
      res.set(
        "Content-Disposition",
        res.get("Content-Disposition") + "; filename*=UTF-8''" + encodedName,
      );
      res.set({
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      });
      res.send(a.data);
    }),
  );
  app.get(
    "/admin/users",
    requireAdmin,
    route(async (req, res) => {
      const users = await q(
        "SELECT id,name,email,role,created_at FROM users ORDER BY id DESC LIMIT 250",
      );
      const deps = await q("SELECT * FROM departments");
      const memberships = await q("SELECT * FROM staff_departments");
      res.send(
        page(
          req,
          "Manage users",
          users
            .map(
              (u) =>
                `<article><strong>${esc(u.name)}</strong> · ${esc(u.email)}<p>Role: ${esc(u.role)}</p>${form(req, "/admin/users/" + u.id + "/role", `<label>Role<select name="role">${["customer", "staff", "admin"].map((role) => `<option value="${role}" ${role === u.role ? "selected" : ""}>${role}</option>`).join("")}</select></label>`)}${u.role !== "customer" ? form(req, "/admin/users/" + u.id + "/departments", deps.map((d) => `<label><input type="checkbox" name="departments" value="${d.id}" ${memberships.some((m) => String(m.user_id) === String(u.id) && String(m.department_id) === String(d.id)) ? "checked" : ""}>${esc(d.name)}</label>`).join("")) : ""}</article>`,
            )
            .join(""),
        ),
      );
    }),
  );
  app.post(
    "/admin/users/:id/role",
    requireAdmin,
    route(async (req, res) => {
      const role = req.body.role;
      if (!["customer", "staff", "admin"].includes(role))
        return fail(res, req, "Invalid role");
      if (
        String(req.params.id) === String(req.session.user.id) &&
        role !== "admin"
      )
        return fail(
          res,
          req,
          "You cannot remove your own administrator access",
        );
      const [target] = await q("SELECT id,role FROM users WHERE id=?", [
        req.params.id,
      ]);
      if (!target) return fail(res, req, "User not found", 404);
      await q("UPDATE users SET role=? WHERE id=?", [role, target.id]);
      await q("INSERT INTO audit_logs (actor_id,action) VALUES (?,?)", [
        req.session.user.id,
        "user-role:" + target.id + ":" + role,
      ]);
      res.redirect("/admin/users");
    }),
  );
  app.get(
    "/admin/departments",
    requireAdmin,
    route(async (req, res) => {
      const departments = await q("SELECT * FROM departments ORDER BY id");
      res.send(
        page(
          req,
          "Departments",
          departments
            .map((d) => `<article>${esc(d.name)} (#${d.id})</article>`)
            .join("") +
            form(req, "/admin/departments", field("New department", "name")),
        ),
      );
    }),
  );
  app.post(
    "/admin/departments",
    requireAdmin,
    route(async (req, res) => {
      const name = clean(req.body.name);
      if (!name || name.length > 100)
        return fail(res, req, "Invalid department name");
      try {
        await q("INSERT INTO departments (name) VALUES (?)", [name]);
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY")
          return fail(res, req, "Department already exists");
        throw e;
      }
      res.redirect("/admin/departments");
    }),
  );
  app.post(
    "/tickets/:id/assign",
    requireStaff,
    route(async (req, res) => {
      const [ticket] = await q("SELECT * FROM tickets WHERE id=?", [
        req.params.id,
      ]);
      if (!ticket || !canAccess(req, ticket))
        return fail(res, req, "Ticket unavailable", 404);
      const id = req.body.staff_id || null;
      if (id) {
        const [u] = await q(
          "SELECT id FROM users WHERE id=? AND (role='admin' OR (role='staff' AND EXISTS (SELECT 1 FROM staff_departments WHERE user_id=users.id AND department_id=?)))",
          [id, ticket.department_id],
        );
        if (!u) return fail(res, req, "Invalid staff member");
      }
      await q("UPDATE tickets SET assigned_to=? WHERE id=?", [
        id,
        req.params.id,
      ]);
      await q(
        "INSERT INTO audit_logs (actor_id,action,ticket_id) VALUES (?,?,?)",
        [req.session.user.id, "assign:" + (id || "none"), req.params.id],
      );
      res.redirect("/tickets/" + req.params.id);
    }),
  );
  app.post(
    "/tickets/:id/status",
    requireStaff,
    route(async (req, res) => {
      const [ticket] = await q("SELECT * FROM tickets WHERE id=?", [
        req.params.id,
      ]);
      if (!ticket || !canAccess(req, ticket))
        return fail(res, req, "Ticket unavailable", 404);
      if (!statuses.includes(req.body.status))
        return fail(res, req, "Invalid status");
      await q("UPDATE tickets SET status=? WHERE id=?", [
        req.body.status,
        req.params.id,
      ]);
      await q(
        "INSERT INTO audit_logs (actor_id,action,ticket_id) VALUES (?,?,?)",
        [req.session.user.id, "status:" + req.body.status, req.params.id],
      );
      res.redirect("/tickets/" + req.params.id);
    }),
  );

  app.post(
    "/tickets/:id/routing",
    requireStaff,
    route(async (req, res) => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [[t]] = await conn.execute(
          "SELECT * FROM tickets WHERE id=? FOR UPDATE",
          [req.params.id],
        );
        if (!t || !canAccess(req, t)) {
          await conn.rollback();
          return fail(res, req, "Ticket unavailable", 404);
        }
        const [deps] = await conn.execute(
          "SELECT id FROM departments WHERE id=?",
          [req.body.department_id || 0],
        );
        if (!deps.length || !priorities.includes(req.body.priority)) {
          await conn.rollback();
          return fail(res, req, "Invalid routing");
        }
        await conn.execute(
          "UPDATE tickets SET department_id=?,priority=?,assigned_to=? WHERE id=?",
          [
            deps[0].id,
            req.body.priority,
            String(t.department_id) === String(deps[0].id)
              ? t.assigned_to
              : null,
            t.id,
          ],
        );
        await conn.execute(
          "INSERT INTO audit_logs(actor_id,action,ticket_id) VALUES (?,?,?)",
          [
            req.session.user.id,
            "routing:" + deps[0].id + ":" + req.body.priority,
            t.id,
          ],
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
      res.redirect("/tickets");
    }),
  );
  app.get(
    "/admin",
    requireStaff,
    route(async (req, res) => {
      const rows = await q(
        "SELECT status,COUNT(*) total FROM tickets " +
          (req.session.user.role === "admin"
            ? ""
            : "WHERE department_id IN (SELECT department_id FROM staff_departments WHERE user_id=?) ") +
          "GROUP BY status",
        req.session.user.role === "admin" ? [] : [req.session.user.id],
      );
      res.send(
        page(
          req,
          "Support overview",

          '<section class="stats" aria-label="Ticket status overview">' +
            statuses
              .map(
                (status) =>
                  "<article><h2>" +
                  esc(rows.find((r) => r.status === status)?.total || 0) +
                  '</h2><a href="/tickets?queue=' +
                  status +
                  '">' +
                  status +
                  " tickets →</a></article>",
              )
              .join("") +
            '</section><section class="overview-actions"><article><h2>Keep your queue moving</h2><p>Review new requests, follow up on pending conversations, and resolve tickets from your workspace.</p><a class="button" href="/tickets?queue=open">View open tickets</a></article><article><h2>Your next assignment</h2><p>Pick up an unassigned request or continue working on tickets already assigned to you.</p><a class="button secondary" href="/tickets?queue=mine">Assigned to me</a> <a class="text-action" href="/tickets?queue=unassigned">Unassigned tickets →</a></article></section>',
        ),
      );
    }),
  );
  app.get(
    "/admin/topics",
    requireAdmin,
    route(async (req, res) => {
      const topics = await q("SELECT * FROM help_topics ORDER BY id"),
        deps = await q("SELECT * FROM departments ORDER BY name");
      const fields = (t) =>
        field("Name", "name", "text", true, t?.name || "") +
        '<label>Department<select name="department_id">' +
        deps
          .map(
            (d) =>
              '<option value="' +
              d.id +
              '" ' +
              (String(t?.department_id) === String(d.id) ? "selected" : "") +
              ">" +
              esc(d.name) +
              "</option>",
          )
          .join("") +
        '</select></label><label>Active<input type="checkbox" name="active" value="1" ' +
        (!t || t.active ? "checked" : "") +
        "></label>";
      res.send(
        page(
          req,
          "Help topics",
          topics
            .map(
              (t) =>
                "<article><h2>" +
                esc(t.name) +
                "</h2>" +
                form(req, "/admin/topics/" + t.id, fields(t)) +
                "</article>",
            )
            .join("") +
            "<h2>Add topic</h2>" +
            form(req, "/admin/topics", fields()),
        ),
      );
    }),
  );
  const saveTopic = route(async (req, res) => {
    const name = clean(req.body.name);
    if (!name || name.length > 100)
      return fail(res, req, "Name must be 1–100 characters");
    const [dep] = await q("SELECT id FROM departments WHERE id=?", [
      req.body.department_id || 0,
    ]);
    if (!dep) return fail(res, req, "Invalid department");
    if (req.params.id)
      await q(
        "UPDATE help_topics SET name=?,department_id=?,active=? WHERE id=?",
        [name, dep.id, req.body.active === "1" ? 1 : 0, req.params.id],
      );
    else
      await q(
        "INSERT INTO help_topics(name,department_id,active) VALUES (?,?,?)",
        [name, dep.id, req.body.active === "1" ? 1 : 0],
      );
    res.redirect("/admin/topics");
  });
  app.post("/admin/topics", requireAdmin, saveTopic);
  app.post("/admin/topics/:id", requireAdmin, saveTopic);
  app.get("/admin/settings", requireAdmin, (req, res) =>
    res.send(
      page(
        req,
        "Configuration",
        form(
          req,
          "/admin/settings",
          field(
            "Desk name",
            "desk_name",
            "text",
            true,
            req.settings.desk_name,
          ) +
            field(
              "Welcome message",
              "welcome_message",
              "text",
              true,
              req.settings.welcome_message,
            ) +
            '<label>Allow guests<input type="checkbox" name="allow_guests" value="1" ' +
            (req.settings.allow_guests === "1" ? "checked" : "") +
            "></label>",
        ) +
          "<p>Current: " +
          esc(req.settings.desk_name) +
          " · " +
          esc(req.settings.welcome_message) +
          "</p>",
      ),
    ),
  );
  app.post(
    "/admin/settings",
    requireAdmin,
    route(async (req, res) => {
      for (const key of ["desk_name", "welcome_message", "allow_guests"]) {
        const value =
          key === "allow_guests"
            ? req.body[key] === "1"
              ? "1"
              : "0"
            : clean(req.body[key]);
        if (!value || value.length > 500)
          return fail(res, req, "Settings must be 1–500 characters");
      }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const key of ["desk_name", "welcome_message", "allow_guests"])
          await conn.execute(
            "UPDATE settings SET setting_value=? WHERE setting_key=?",
            [
              key === "allow_guests"
                ? req.body[key] === "1"
                  ? "1"
                  : "0"
                : clean(req.body[key]),
              key,
            ],
          );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
      res.redirect("/admin/settings");
    }),
  );
  app.get(
    "/admin/audit",
    requireAdmin,
    route(async (req, res) => {
      const rows = await q(
        "SELECT a.*,u.name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200",
      );
      res.send(
        page(
          req,
          "Recent audit events",
          rows
            .map(
              (r) =>
                "<article>" +
                esc(r.created_at) +
                " · " +
                esc(r.name) +
                " · " +
                esc(r.action) +
                " · #" +
                esc(r.ticket_id) +
                "</article>",
            )
            .join(""),
        ),
      );
    }),
  );
  app.post(
    "/admin/users/:id/departments",
    requireAdmin,
    route(async (req, res) => {
      const ids = Array.isArray(req.body.departments)
        ? req.body.departments
        : [req.body.departments].filter(Boolean);
      const deps = await q("SELECT id FROM departments");
      if (ids.some((id) => !deps.some((d) => String(d.id) === id)))
        return fail(res, req, "Invalid department");
      const [target] = await q(
        "SELECT id FROM users WHERE id=? AND role IN ('staff','admin')",
        [req.params.id],
      );
      if (!target) return fail(res, req, "Staff account required");
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute("DELETE FROM staff_departments WHERE user_id=?", [
          target.id,
        ]);
        for (const id of ids)
          await conn.execute(
            "INSERT INTO staff_departments(user_id,department_id) VALUES (?,?)",
            [target.id, id],
          );
        await conn.execute(
          "INSERT INTO audit_logs(actor_id,action) VALUES (?,?)",
          [
            req.session.user.id,
            "membership:" + target.id + ":" + ids.join(","),
          ],
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
      res.redirect("/admin/users");
    }),
  );
  app.use((req, res) => fail(res, req, "Page not found", 404));
  app.use((err, req, res, next) => {
    if (!req.session)
      return res.status(err.status === 413 ? 413 : 400).send("Invalid request");
    console.error({ code: err.code || err.name, message: err.message });
    if (
      err instanceof multer.MulterError ||
      err.message === "Unsupported attachment type"
    )
      return res
        .status(400)
        .send(
          page(
            req,
            "Upload rejected",
            "<p>Attachment rejected. Maximum 5 MB; PNG, JPEG, WebP, PDF, or plain text only.</p>",
          ),
        );
    if (err.code === "ER_DUP_ENTRY")
      return fail(res, req, "That name is already in use");
    res
      .status(500)
      .send(
        page(
          req,
          "Server error",
          "<p>Something went wrong. Check the server logs.</p>",
        ),
      );
  });
  return app;
}
