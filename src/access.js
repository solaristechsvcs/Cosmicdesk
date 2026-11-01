import crypto from "node:crypto";
export const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const csrf = (req) => {
  if (!req.session.csrf)
    req.session.csrf = crypto.randomBytes(24).toString("hex");
  return req.session.csrf;
};
export const staff = (req) =>
  ["staff", "admin"].includes(req.session?.user?.role);
export const canAccess = (req, t) =>
  staff(req)
    ? req.session.user.role === "admin" ||
      req.departmentIds.includes(String(t.department_id))
    : (req.session.user &&
        String(t.customer_id) === String(req.session.user.id)) ||
      (t.guest_token_hash &&
        hash(
          String(
            req.query.token ||
              req.body?.token ||
              req.session.guestTickets?.[t.id] ||
              "",
          ),
        ) === t.guest_token_hash);
