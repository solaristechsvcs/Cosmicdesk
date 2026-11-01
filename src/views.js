import { csrf, staff } from "./access.js";
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
export const field = (
  label,
  name,
  type = "text",
  required = true,
  value = "",
) =>
  `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;

export const form = (req, action, body, multipart = false) => {
  const label =
    action === "/logout"
      ? "Sign out"
      : action.endsWith("/reply")
        ? "Send reply / note"
        : action === "/tickets/new"
          ? "Create ticket"
          : action === "/login"
            ? "Sign in"
            : action === "/register"
              ? "Create account"
              : "Save changes";
  return `<form method="post" action="${action}" ${multipart ? 'enctype="multipart/form-data"' : ""}><input type="hidden" name="_csrf" value="${csrf(req)}">${body}<div class="form-actions"><button>${label}</button></div></form>`;
};
const queues = [
  ["open", "Open tickets"],
  ["mine", "Assigned to me"],
  ["unassigned", "Unassigned"],
  ["pending", "Pending"],
  ["closed", "Closed"],
  ["all", "All tickets"],
];
export const badge = (value, kind = "status") =>
  `<span class="badge ${kind}-${esc(value)}">${esc(value)}</span>`;
export const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC";
};
export const ticketTable = (rows) =>
  `<div class="table-scroll"><table class="ticket-table"><thead><tr><th scope="col">Ticket</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Department</th><th scope="col">Assigned to</th><th scope="col">Last updated</th></tr></thead><tbody>${rows.map((t) => `<tr><td><a class="ticket-number" href="/tickets/${t.id}">#${t.id}</a></td><td class="subject"><a href="/tickets/${t.id}">${esc(t.subject)}</a></td><td>${badge(t.status)}</td><td>${badge(t.priority, "priority")}</td><td>${esc(t.department)}</td><td>${esc(t.assignee || "Unassigned")}</td><td class="date">${esc(dateLabel(t.updated_at))}</td></tr>`).join("") || '<tr><td colspan="7" class="empty-state"><strong>No tickets in this view</strong><p>Choose another queue or adjust your search.</p></td></tr>'}</tbody></table></div>`;
export const page = (req, title, body) => {
  const isStaff = staff(req),
    user = req.session?.user,
    path = req.path || "/",
    queue = String(req.query?.queue || "open");
  const desk = esc(req.settings?.desk_name || "CosmicDesk");
  const link = (href, label, active) =>
    `<a href="${href}" ${active ? 'aria-current="page"' : ""}>${label}</a>`;
  const sidebar = isStaff
    ? `<aside class="sidebar"><div class="workspace-label">STAFF WORKSPACE</div><nav aria-label="Workspace">${link("/admin", "Overview", path === "/admin")}<div class="nav-label">TICKETS</div>${queues.map(([key, label]) => link("/tickets?queue=" + key, label, path === "/tickets" && queue === key)).join("")}</nav>${
        user.role === "admin"
          ? `<nav aria-label="Administration"><div class="nav-label">ADMINISTRATION</div>${[
              ["users", "People & roles"],
              ["departments", "Departments"],
              ["topics", "Help topics"],
              ["settings", "Configuration"],
              ["audit", "Audit log"],
            ]
              .map(([key, label]) =>
                link("/admin/" + key, label, path === "/admin/" + key),
              )
              .join("")}</nav>`
          : ""
      }<div class="sidebar-footer"><span class="orbit-dot"></span> CosmicDesk helpdesk</div></aside>`
    : "";
  const descriptions =
    path === "/tickets"
      ? isStaff
        ? "Manage requests, follow conversations, and keep your team moving."
        : "Follow your support requests and continue the conversation."
      : path === "/admin"
        ? "Your support operation at a glance."
        : path === "/tickets/new"
          ? "Tell us what you need. We’ll route your request to the right team."
          : path.startsWith("/tickets/")
            ? "Review the conversation and manage this support request."
            : path.startsWith("/admin/")
              ? "Manage your helpdesk workspace."
              : "";
  const breadcrumb = isStaff ? "Staff workspace" : "Support center";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | ${desk}</title><script src="/theme.js?v=1"></script><link rel="stylesheet" href="/style.css?v=theme-1"></head><body class="${isStaff ? "staff-layout" : "portal-layout"}"><a class="skip-link" href="#main">Skip to content</a><header class="topbar"><a class="brand" href="${isStaff ? "/admin" : "/"}"><span class="brand-mark" aria-hidden="true">✦</span>${desk}</a><span class="product-label">${isStaff ? "Helpdesk workspace" : "Customer support"}</span><nav class="account-nav" aria-label="Account"><button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark mode" hidden><span aria-hidden="true">◐</span><span data-theme-label>Dark mode</span></button>${!isStaff ? link("/tickets", "My tickets", path === "/tickets") : link("/", "Support portal", false)}${user ? `<span class="account-name">${esc(user.name)}<small>${esc(user.role)}</small></span>${form(req, "/logout", "")}` : link("/login", "Sign in", path === "/login") + link("/register", "Create account", path === "/register")}</nav></header><div class="app-shell">${sidebar}<div class="workspace"><main id="main" class="${path === "/login" || path === "/register" ? "auth-page" : ""}"><div class="page-heading"><div><div class="breadcrumb">${breadcrumb} <span>/</span> ${path.startsWith("/admin/") ? "Administration" : path.startsWith("/tickets") ? "Tickets" : "Overview"}</div><h1>${esc(title)}</h1>${descriptions ? `<p>${descriptions}</p>` : ""}</div>${path !== "/tickets/new" ? '<a class="button" href="/tickets/new">+ New ticket</a>' : ""}</div>${body}</main><footer>${desk} <span>·</span> Customer support across the universe</footer></div></div></body></html>`;
};
