# Migrations and rollback

Inspected main baseline: `7a67c1f7a5eaaae8c673788283b4e484817b78c4`. This replacement is a descendant commit; no history reset or force push is required.

## Existing installation

1. Stop the old Node process and take a full database backup (including BLOB attachments), plus a private copy of config.js. Test restoration before upgrading.
2. Keep the existing database; do **not** re-import schema.sql. Install this checkout with `npm ci`.
3. Run `npm run migrate`. Migration 001 ensures the attachment table exists. Migration 002 adds topics, nullable ticket topic references, staff membership, settings and a queue index. Existing users/tickets/messages/attachments are not deleted. Existing staff receive all current departments to preserve prior visibility; review and narrow membership before reopening access. New departments do not automatically grant access.
4. Start the app; check health, login, an old customer ticket, guest access, and staff/private attachments.

## New installation

Import schema.sql into an empty database, then run npm run migrate. schema.sql is deliberately the original baseline; both new and existing installs converge through the same migrations. Never apply migration 002 manually and then run the runner without recording it.

The runner records completed filenames in schema_migrations and serializes runners using GET_LOCK. Successful repeated runs skip completed files. MySQL DDL implicitly commits: migration 002 is **not atomic**. If it fails halfway, stop and inspect tables/indexes and schema_migrations. Restore the backup and rerun, or have an operator reconcile the partial statements before recording completion. Do not blindly rerun partial DDL. The app refuses startup if the ticket topic column is absent; migrations must finish before serving traffic.

## Rollback

Stop the new process. Restore the pre-upgrade database backup and previous code/config together, then verify old behavior. Avoid deleting the new tables/columns as an improvised rollback: new tickets may depend on them. Restoring a backup loses changes made after that backup; export those separately if needed. No automatic destructive down migration is provided.
