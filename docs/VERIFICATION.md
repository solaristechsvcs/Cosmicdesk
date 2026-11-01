# Verification

Local: npm run check passes. npm test passes HTTP/security and access-policy tests; the MySQL workflow suite is skipped locally because this workstation has no MySQL or Docker runtime. npm audit after the driver override reported zero vulnerabilities.

GitHub Actions provisions MySQL 8.4, imports the original schema, applies migrations twice (checks repeatability after success), and runs the full suite. The database scenario verifies login, customer ownership, private guest links and wrong-token denial, escaped ticket content, private notes and attachment access, assignments, status changes, filtered queues, cross-department read/mutation denial, staff/admin separation, guest disablement, membership revocation, self-demotion protection, help-topic/department creation, audit page access and closed-ticket reply refusal. It uses an isolated disposable database and synthetic accounts; never point the test at production.

No production deployment, Wisp panel test, Docker image build, browser visual inspection, load test or malware scan has been performed by these tests. Verify HTTPS cookies, proxy trust, backups and old private links in staging before public rollout.

## Confirmed CI result

[Helpdesk checks run 41344717524](https://github.com/solaristechsvcs/Cosmicdesk/actions/runs/41344717524) passed on commit b67c734208b81486da8c72345d675408abbb4294. All seven tests passed against MySQL 8.4, with no skips. Baseline import, both migration invocations, syntax checks and production dependency audit passed. The integration scenario also checks department transfer, priority changes and clearing the former assignment. Local HTTP/access tests: six passed, with only the MySQL scenario skipped locally.

## Business layout update

Visually inspected the actual ticket queue and conversation templates using synthetic preview data, plus a 390-pixel-wide queue preview. Checked sidebar navigation, compact table, internal-note styling, ticket-property forms and responsive navigation. These previews use sample data, not a live production database. This supersedes the original release's statement that browser visual inspection had not been performed. No schema migration is required for this layout update.

## Restart updater verification

Updater tests cover protected paths, staging without Git, retaining configuration/environment/uploads, skipping unchanged revisions, checksum and dependency failures, invalid trees/destinations, overlapping update locks, offline fallback, migration failure and source/dependency rollback on activation failure. GitHub CI also smoke-tests the real Node restart entrypoint against MySQL with network updating disabled; it checks health and login-page delivery. Live Wisp restarts are not tested from this workspace.

## Partial migration recovery

MySQL regression coverage reproduces an existing help_topic_id column with missing migration history, verifies recovery and repeat runs, and checks preservation of ticket content, guest token hashes, attachment bytes, custom topics/settings and restricted staff membership. It also removes/recreates missing FK/index objects and confirms that incompatible existing column definitions fail without recording migration completion. Tests use a separate disposable recovery database.

Attachment download regression tests verify original filename/extension, spaces, Unicode, escaped quotes, unchanged bytes, stripped path/control characters, guest authorization and internal-note privacy. The MySQL workflow also verifies private.txt downloads with its stored name and original content.

Theme toggle visually checked on the actual staff ticket template using sample data: dark/light appearance, header action, and persistence after page reload. Theme preference is browser-local and external script loading remains within the existing Content Security Policy.
