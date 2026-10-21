// Copy to config.js on Wisp. Do not commit config.js or real credentials.
export default {
  port: 3014,
  host: "0.0.0.0",
  sessionSecret: "REPLACE_WITH_A_LONG_RANDOM_SECRET",
  mysql: { host: "127.0.0.1", port: 3306, user: "cosmicdesk", password: "REPLACE_ME", database: "cosmicdesk" },
  // Set this to the public HTTPS origin for links in emails later.
  publicUrl: "https://desk.example.com"
};
