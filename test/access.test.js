import test from "node:test";
import assert from "node:assert/strict";
import { canAccess, hash } from "../src/access.js";
const ticket = {
  id: 7,
  department_id: 1,
  customer_id: 3,
  guest_token_hash: hash("private-token"),
};
const req = (user, extra = {}) => ({
  session: { user },
  query: {},
  departmentIds: [],
  ...extra,
});
test("department boundary applies even if staff own the ticket or know its guest token", () => {
  assert.equal(
    Boolean(
      canAccess(
        req({ id: 3, role: "staff" }, { query: { token: "private-token" } }),
        ticket,
      ),
    ),
    false,
  );
  assert.equal(
    canAccess(req({ id: 2, role: "staff" }, { departmentIds: ["1"] }), ticket),
    true,
  );
  assert.equal(canAccess(req({ id: 1, role: "admin" }), ticket), true);
});
test("customer ownership and guest links are scoped to the ticket", () => {
  assert.equal(
    Boolean(canAccess(req({ id: 4, role: "customer" }), ticket)),
    false,
  );
  assert.equal(
    Boolean(canAccess(req({ id: 3, role: "customer" }), ticket)),
    true,
  );
  assert.equal(
    Boolean(
      canAccess(req(null, { query: { token: "private-token" } }), ticket),
    ),
    true,
  );
  assert.equal(
    Boolean(canAccess(req(null, { query: { token: "wrong" } }), ticket)),
    false,
  );
});
