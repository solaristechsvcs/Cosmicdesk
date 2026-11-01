# Deployment

## Wisp

Use a Node.js 24 image, the server's allocated port in config.js (or PORT), host 0.0.0.0 and MAIN_FILE=server.js. Upload source and package-lock.json, keep config.js private, run npm ci --omit=dev, import schema.sql only for an empty database, and run npm run migrate in the console before node server.js. Wisp's external MySQL host belongs in mysql.host; localhost refers to the application container. No writable upload directory is needed because files live in MySQL.

Terminate HTTPS at the panel proxy. Set NODE_ENV=production and secureCookies=true. Set trustProxy to the known proxy hop count (the example supports TRUST_PROXY=1 for exactly one trusted proxy), and block direct access to the backend. Misconfigured trust can break login or allow spoofed rate-limit identities. For direct local HTTP testing only, use secureCookies=false and no trusted proxy. Never reuse another project's session secret.

## Docker Compose

Copy config.example.js to config.js. Set DB_PASSWORD, DB_ROOT_PASSWORD and SESSION_SECRET in a private .env file; .env is ignored. Run docker compose up --build -d. A new database volume imports the baseline schema automatically, then web runs migrations before startup. Existing volumes must already contain the baseline; back them up first. Port 3014 binds only to host loopback; put an HTTPS reverse proxy in front. The supplied production configuration expects one proxy hop and secure cookies.

The image runs as the unprivileged node user; config.js is mounted read-only and excluded from the build context. MySQL has a named persistent volume. Do not delete the volume when upgrading. Keep database credentials and session secrets outside the image. Custom config.js can override environment defaults deliberately.

## Operations

Health endpoint: GET /health checks the database (and middleware requires migrated settings). Back up MySQL including sessions and attachment BLOBs. Set MySQL max_allowed_packet above 6 MiB and proxy request limit above 5 MiB plus form overhead. Keep application instances behind a shared edge rate limiter if scaling; the built-in limit is process-local. Capture logs without query strings to keep guest links private. Test a fresh browser's guest link after proxy setup. Use npm audit --omit=dev and apply dependency updates routinely. No email server is needed in this release.

## Automatic updates on Wisp restarts

`server.js` is now a self-contained restart bootstrap using only Node built-ins. It checks public GitHub `solaristechsvcs/Cosmicdesk` main on each normal start, downloads a pinned revision without requiring Git or tar, verifies every downloaded file's Git blob checksum, installs locked production dependencies in staging, and then activates the new source and dependencies. A fresh child process loads the installed application after migrations succeed. Keep MAIN_FILE=server.js / startup command `node server.js`.

To enable on an existing Wisp installation, replace server.js once with the latest repository version, then restart. The bootstrap can fetch the remaining source files itself. Node.js 24, npm, outbound HTTPS to api.github.com/raw.githubusercontent.com/registry.npmjs.org and a writable application directory are required. Keep config.js in the server directory. Future restarts check main automatically; no Git checkout or Git credentials are needed because the repository is public.

The updater never downloads or replaces config.js, .env files, uploads, data, logs, node_modules from the repository, or .git. Locally edited application source **is replaced by main**. Store custom settings in config.js; contribute source edits to the repository. Do not alternate this updater with manual git pull operations on the deployment checkout, whose Git index is not updated by the downloader. Database changes run through the migration runner on every start (completed migrations are skipped), not by reimporting schema.sql. Back up MySQL before deploying migration changes to main; database backup/rollback is still an operator responsibility.

The last installed commit/file list is recorded in .cosmicdesk-version.json. The .cosmicdesk-update directory retains staged files, source backups and previous node_modules from the last update; budget space for roughly two installations. The next changed revision replaces that workspace. Previously installed source files removed from main are removed only when recorded in updater state. Untracked local files are retained. First activation downloads even if the installed source already matches main; later starts skip unchanged revisions.

Network/checksum/dependency preparation failure keeps the installed source and attempts to start it. Activation failures restore previous source/dependencies and stop startup; migrations or dependency-install failures also stop startup. Partially applied MySQL DDL still requires operator recovery as described in MIGRATIONS.md. An active update lock blocks overlapping updaters. If an unclean shutdown leaves a lock referring to a reused/live PID, stop every instance before removing .cosmicdesk-update.lock manually.

To temporarily pin the installed version, set COSMICDESK_AUTO_UPDATE=0 in Wisp's process environment (not merely a .env file: no dotenv loader is used). Startup still checks installed dependencies and runs pending migrations. Docker images set this flag by default; rebuild images for updates. `node server.js --serve` is the internal launch mode and deliberately bypasses updates/migrations; do not use it as the Wisp startup command.

Logs show [update] and [startup] steps. GitHub's unauthenticated API rate limits may cause a restart to use the installed version until the limit resets. If no working source/dependencies are present, an offline fallback cannot start the application. No live Wisp server or credentials were accessed in implementing this feature.
