# Deployment

## Wisp

Use a Node.js 24 image, the server's allocated port in config.js (or PORT), host 0.0.0.0 and MAIN_FILE=server.js. Upload source and package-lock.json, keep config.js private, run npm ci --omit=dev, import schema.sql only for an empty database, and run npm run migrate in the console before node server.js. Wisp's external MySQL host belongs in mysql.host; localhost refers to the application container. No writable upload directory is needed because files live in MySQL.

Terminate HTTPS at the panel proxy. Set NODE_ENV=production and secureCookies=true. Set trustProxy to the known proxy hop count (the example supports TRUST_PROXY=1 for exactly one trusted proxy), and block direct access to the backend. Misconfigured trust can break login or allow spoofed rate-limit identities. For direct local HTTP testing only, use secureCookies=false and no trusted proxy. Never reuse another project's session secret.

## Docker Compose

Copy config.example.js to config.js. Set DB_PASSWORD, DB_ROOT_PASSWORD and SESSION_SECRET in a private .env file; .env is ignored. Run docker compose up --build -d. A new database volume imports the baseline schema automatically, then web runs migrations before startup. Existing volumes must already contain the baseline; back them up first. Port 3014 binds only to host loopback; put an HTTPS reverse proxy in front. The supplied production configuration expects one proxy hop and secure cookies.

The image runs as the unprivileged node user; config.js is mounted read-only and excluded from the build context. MySQL has a named persistent volume. Do not delete the volume when upgrading. Keep database credentials and session secrets outside the image. Custom config.js can override environment defaults deliberately.

## Operations

Health endpoint: GET /health checks the database (and middleware requires migrated settings). Back up MySQL including sessions and attachment BLOBs. Set MySQL max_allowed_packet above 6 MiB and proxy request limit above 5 MiB plus form overhead. Keep application instances behind a shared edge rate limiter if scaling; the built-in limit is process-local. Capture logs without query strings to keep guest links private. Test a fresh browser's guest link after proxy setup. Use npm audit --omit=dev and apply dependency updates routinely. No email server is needed in this release.
