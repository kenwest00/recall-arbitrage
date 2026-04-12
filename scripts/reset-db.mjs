import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.query('SHOW TABLES');
console.log('Existing tables:', rows);

// Drop all app tables to allow fresh migration
const tablesToDrop = [
  'msrp_data', 'pricing_data', 'profit_analysis', 'recalls',
  'reports', 'sync_log', 'user_settings', '__drizzle_migrations'
];

for (const table of tablesToDrop) {
  try {
    await conn.query(`DROP TABLE IF EXISTS \`${table}\``);
    console.log(`Dropped: ${table}`);
  } catch (e) {
    console.log(`Skip ${table}: ${e.message}`);
  }
}

await conn.end();
console.log('Done');
