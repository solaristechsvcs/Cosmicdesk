import config from "./config.js";
import mysql from "mysql2/promise";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import { createApp } from "./src/app.js";
if (
  !config.sessionSecret ||
  config.sessionSecret.length < 32 ||
  config.sessionSecret.startsWith("REPLACE")
)
  throw new Error("Set a unique sessionSecret of at least 32 characters");
const pool = mysql.createPool({
  ...config.mysql,
  connectionLimit: 10,
  waitForConnections: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
});
await pool.execute("SELECT help_topic_id FROM tickets LIMIT 0");
const Store = MySQLStoreFactory(session);
const store = new Store({ ...config.mysql, createDatabaseTable: true });
const app = createApp({ config, pool, store });
const server = app.listen(config.port, config.host || "0.0.0.0", () =>
  console.log("CosmicDesk ready on port " + config.port),
);
process.on("SIGTERM", () =>
  server.close(async () => {
    await store.close();
    await pool.end();
    process.exit(0);
  }),
);
