import mysql from "mysql2/promise";
import config from "../config.js";
import { migrate } from "./migrations.js";
const db = await mysql.createConnection({
  ...config.mysql,
  multipleStatements: true,
});
try {
  await migrate(db);
} finally {
  await db.end();
}
