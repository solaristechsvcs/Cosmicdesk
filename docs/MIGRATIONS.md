# Migrations and rollback

Inspected main baseline: `7a67c1f7a5eaaae8c673788283b4e484817b78c4`. This replacement is a descendant commit; no history reset or force push is required.

## Existing installation

1. Stop the old Node process and take a full database backup (including BLOB attachments), plus a private copy of config.js. Test restoration before upgrading.
2. Keep the existing database; do **not** re-import schema.sql. Install this checkout with `npm ci`.
3. Run `npm run migrate`. Migration 001 ensures the attachment table exists. Migration 002 adds topics, nullable ticket topic references, staff membership, settings and a queue index. Existing users/tickets/messages/attachments are not deleted. When the staff membership table is first created, existing staff receive current departments to preserve prior visibility; review and narrow membership before reopening access. Recovery never adds memberships to an already-existing table. New departments do not automatically grant access.
4. Start the app; check health, login, an old customer ticket, guest access, and staff/private attachments.

## New installation

Import schema.sql into an empty database, then run npm run migrate. schema.sql is deliberately the original baseline; both new and existing installs converge through the same migrations. Never apply migration 002 manually and then run the runner without recording it.

The runner records completed filenames in schema_migrations and serializes runners using GET_LOCK. Successful repeated runs skip completed files. MySQL DDL implicitly commits: migration 002 is **not atomic**. The migration 002 runner now checks information_schema before creating its ticket column, foreign key and queue index. It can safely resume the known standard partial upgrade, or reconcile the expected schema when its completion record is missing. It records completion only after all steps succeed. Unexpected column/index/foreign-key definitions still stop migration and require operator inspection; do not manually mark an incompatible schema complete. The app refuses startup if the ticket topic column is absent; migrations must finish before serving traffic.

## Rollback

Stop the new process. Restore the pre-upgrade database backup and previous code/config together, then verify old behavior. Avoid deleting the new tables/columns as an improvised rollback: new tickets may depend on them. Restoring a backup loses changes made after that backup; export those separately if needed. No automatic destructive down migration is provided.


## Duplicate help_topic_id recovery

If startup previously failed with Duplicate column name help_topic_id, install the latest main and restart (the Wisp updater does this automatically). The runner retains the compatible column, verifies/adds the help-topic foreign key and queue index, ensures supporting tables/defaults, and records migration 002 only after success. Existing settings, topics, messages, attachments, guest tokens and department membership are preserved. If the membership table was created during an interrupted upgrade but never populated, an admin must assign staff departments; recovery deliberately avoids granting extra access. No table drop, data reset or manual schema_migrations insertion is needed for the standard schema.
