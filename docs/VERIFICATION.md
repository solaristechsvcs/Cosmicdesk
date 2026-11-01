# Verification

Local: npm run check passes. npm test passes HTTP/security and access-policy tests; the MySQL workflow suite is skipped locally because this workstation has no MySQL or Docker runtime. npm audit after the driver override reported zero vulnerabilities.

GitHub Actions provisions MySQL 8.4, imports the original schema, applies migrations twice (checks repeatability after success), and runs the full suite. The database scenario verifies login, customer ownership, private guest links and wrong-token denial, escaped ticket content, private notes and attachment access, assignments, status changes, filtered queues, cross-department read/mutation denial, staff/admin separation, guest disablement, membership revocation, self-demotion protection, help-topic/department creation, audit page access and closed-ticket reply refusal. It uses an isolated disposable database and synthetic accounts; never point the test at production.

No production deployment, Wisp panel test, Docker image build, browser visual inspection, load test or malware scan has been performed by these tests. Verify HTTPS cookies, proxy trust, backups and old private links in staging before public rollout.
