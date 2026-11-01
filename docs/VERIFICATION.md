# Verification

Local: npm run check passes. npm test passes HTTP/security and access-policy tests; the MySQL workflow suite is skipped locally because this workstation has no MySQL or Docker runtime. npm audit after the driver override reported zero vulnerabilities.

GitHub Actions provisions MySQL 8.4, imports the original schema, applies migrations twice (checks repeatability after success), and runs the full suite. The database scenario verifies login, customer ownership, private guest links and wrong-token denial, escaped ticket content, private notes and attachment access, assignments, status changes, filtered queues, cross-department read/mutation denial, staff/admin separation, guest disablement, membership revocation, self-demotion protection, help-topic/department creation, audit page access and closed-ticket reply refusal. It uses an isolated disposable database and synthetic accounts; never point the test at production.

No production deployment, Wisp panel test, Docker image build, browser visual inspection, load test or malware scan has been performed by these tests. Verify HTTPS cookies, proxy trust, backups and old private links in staging before public rollout.

## Confirmed CI result

[Helpdesk checks run 41344717524](https://github.com/solaristechsvcs/Cosmicdesk/actions/runs/41344717524) passed on commit b67c734208b81486da8c72345d675408abbb4294. All seven tests passed against MySQL 8.4, with no skips. Baseline import, both migration invocations, syntax checks and production dependency audit passed. The integration scenario also checks department transfer, priority changes and clearing the former assignment. Local HTTP/access tests: six passed, with only the MySQL scenario skipped locally.

## Business layout update

Visually inspected the actual ticket queue and conversation templates using synthetic preview data, plus a 390-pixel-wide queue preview. Checked sidebar navigation, compact table, internal-note styling, ticket-property forms and responsive navigation. These previews use sample data, not a live production database. This supersedes the original release's statement that browser visual inspection had not been performed. No schema migration is required for this layout update.
