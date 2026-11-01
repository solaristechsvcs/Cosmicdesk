# CosmicDesk 0.2

An original cosmic-themed helpdesk built with Node.js 24, Express and MySQL 8.4. The workflow takes inspiration from conventional helpdesks, including osTicket; no osTicket branding or source is included. Existing GPL license remains in place.

## Implemented

- Customer registration, password hashing, login/logout, personal ticket history and replies.
- Guest submission and tracking through a private 256-bit access link, stored hashed in MySQL. Save the link: it is not emailed and cannot currently be recovered.
- Help topics route new requests into departments. Priorities: low, normal, high, urgent; states: open, pending, closed. Customers cannot reply to closed tickets; staff can reopen them.
- Staff dashboard and paginated queues: open, pending, closed, mine, unassigned and all, with subject/number search. My tickets includes closed assignments.
- Department membership limits staff lists, dashboard, ticket reads, replies, file downloads and mutations. Administrators see every department. Newly promoted staff need department membership.
- Agent assignment, unassignment, department transfer (clears assignment), priority and status changes.
- Public replies and private internal notes. One attachment per submission/reply/note, up to 5 MiB; PNG/JPEG/WebP/PDF/text MIME allowlist. Files are stored in MySQL and downloaded as binary; internal-note files require staff access.
- Admin pages to change user roles/memberships, create departments, create/edit/deactivate help topics, configure desk name/welcome text/guest submission, and view the latest 200 audit events. Self-demotion is blocked.
- MySQL sessions, CSRF protection, escaped HTML, security headers, session regeneration, live role/membership refresh and basic per-process write/login limits.
- Versioned migration runner, lockfile, Docker/Compose, Wisp instructions and GitHub Actions with MySQL workflow tests.

## Start

1. Create a dedicated MySQL database and user. Import `schema.sql` into an **empty** database.
2. Copy `config.example.js` to `config.js`, configure credentials and a unique random secret of at least 32 characters. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
3. Run `npm ci`, then `npm run migrate`, then `npm start`.
4. Open the configured port (default 3014). Register an account, then bootstrap its administrator role using the exact account email:
   `UPDATE users SET role='admin' WHERE email='you@example.com';`
5. Set up departments, help topics, staff roles and memberships through Mission control. Verify `/health`.

See [deployment](docs/DEPLOYMENT.md), [migration and rollback](docs/MIGRATIONS.md), [architecture and access policy](docs/ARCHITECTURE.md), and [verification](docs/VERIFICATION.md).

## Pending / limits

This is the initial web helpdesk release. Email delivery and ingestion, email verification, password/link recovery, MFA/SSO, SLAs, escalations, saved/custom queues, teams, canned replies, knowledge base, notifications, reporting, custom fields and an external API are not implemented. Staff use existing registered accounts promoted by an admin; invitations and account suspension/deletion are pending. Department rename/deactivation and bulk operations are pending. Customers have not been imported from another product.

Attachments use client-declared MIME filtering, not malware scanning or content sniffing; storage quotas and retention are pending. Rate limits are per process and reset on restart; use edge abuse protection for public traffic. Audit covers role, membership, assignment, status and routing changes, not every read or configuration edit. Agent/admin roles have fixed permissions, not customizable permission sets. Admin user management lists the latest 250 accounts; broader account search/pagination is pending. There is no live production deployment in this change.

## Business workspace layout

The staff workspace now uses a light business layout with a navy sidebar, persistent queue/admin navigation, compact ticket tables, status/priority badges and a split conversation/properties view. The customer portal uses the same visual language with simpler navigation. CosmicDesk's purple accents and original identity remain. This interface update needs no database migration: update the application files, restart Node and reload the browser. The stylesheet URL is versioned to avoid stale cached styling.

## Restart updates

Wisp's `node server.js` entrypoint now updates application source from this repository's main branch on restart, preserves private configuration/runtime data, installs production dependencies and applies pending migrations before launching. Replace server.js once on an existing installation to enable it. Set COSMICDESK_AUTO_UPDATE=0 to pin the installed code. See the [restart updater details](docs/DEPLOYMENT.md#automatic-updates-on-wisp-restarts) for requirements and failure behavior. Docker image updates remain build-based.
