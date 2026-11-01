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
export const form = (req, action, body, multipart = false) =>
  `<form method="post" action="${action}" ${multipart ? 'enctype="multipart/form-data"' : ""}><input type="hidden" name="_csrf" value="${csrf(req)}">${body}<button>Submit</button></form>`;
export const page = (req, title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | ${esc(req.settings?.desk_name || "CosmicDesk")}</title><link rel="stylesheet" href="/style.css"></head><body><header><a class="brand" href="/">✦ CosmicDesk</a><nav><a href="/tickets">Tickets</a> <a href="/tickets/new">New Ticket</a> ${staff(req) ? '<a href="/admin">Dashboard</a>' : ""} ${req.session?.user ? `<span>${esc(req.session?.user.name)} (${esc(req.session?.user.role)})</span> ${form(req, "/logout", "")}` : '<a href="/login">Login</a> <a href="/register">Register</a>'}</nav></header><main><h1>${esc(title)}</h1>${body}</main><footer>CosmicDesk · Customer support across the universe</footer></body></html>`;
