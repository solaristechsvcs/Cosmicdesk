# CosmicDesk

Cosmic-themed customer support and helpdesk application using Node.js and MySQL.

## Implemented
- Registered customer accounts, secure password hashing and login
- Guest ticket creation with a private, randomly generated ticket URL
- Departments, ticket priorities, replies and ticket status
- Staff ticket queue, internal notes, status changes and basic dashboard
- Cosmic-themed responsive frontend

## Deploy on Wisp
1. Provision a MySQL database and import `schema.sql`.
2. Copy `config.example.js` to `config.js`; set MySQL details, allocated port, and a long random session secret.
3. Run `npm install` and start with `node server.js` (MAIN_FILE: `server.js`).
4. Visit `/health` to verify the database connection.
5. To bootstrap an admin, register your account and run `UPDATE users SET role='admin' WHERE email='your-email@example.com';` in MySQL.

## Important
This is an early MVP, not yet ready for public production use. Before launch add rate limiting, spam protection, account recovery, email verification, email delivery, trusted-proxy and secure-cookie configuration, tests and monitoring. Guest customers must save their ticket URL: email delivery and lost-link recovery are not implemented. Ticket attachments, staff assignment, account administration, knowledge base, and detailed analytics remain on the roadmap.

Never commit `config.js` or credentials.
