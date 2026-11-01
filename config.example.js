// Copy to config.js. Keep real credentials outside version control.
export default {
 port: Number(process.env.PORT || 3014), host: '0.0.0.0',
 sessionSecret: process.env.SESSION_SECRET || 'REPLACE_WITH_32_OR_MORE_RANDOM_CHARACTERS',
 mysql: {host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'cosmicdesk', password: process.env.DB_PASSWORD || 'REPLACE_ME', database: process.env.DB_NAME || 'cosmicdesk'},
 publicUrl: process.env.PUBLIC_URL || 'http://localhost:3014',
 // Set true behind one trusted HTTPS reverse proxy; never expose that backend directly.
 trustProxy: process.env.TRUST_PROXY === '1' ? 1 : false,
 secureCookies: process.env.NODE_ENV === 'production'
};
