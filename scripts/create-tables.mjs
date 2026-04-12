import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const statements = [
  `CREATE TABLE IF NOT EXISTS \`user_settings\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`userId\` int NOT NULL,
    \`refreshIntervalHours\` int NOT NULL DEFAULT 24,
    \`profitThreshold\` decimal(5,2) NOT NULL DEFAULT '10.00',
    \`preferredAgencies\` json,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`user_settings_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`user_settings_userId_unique\` UNIQUE(\`userId\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`recalls\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`recallNumber\` varchar(64) NOT NULL,
    \`agency\` enum('CPSC','NHTSA') NOT NULL,
    \`title\` text NOT NULL,
    \`productName\` text,
    \`manufacturer\` text,
    \`category\` varchar(128),
    \`description\` text,
    \`hazard\` text,
    \`remedy\` text,
    \`rawNotice\` text,
    \`refundValue\` decimal(10,2),
    \`refundExtracted\` boolean NOT NULL DEFAULT false,
    \`refundNotes\` text,
    \`recallDate\` timestamp NULL,
    \`recallUrl\` text,
    \`imageUrl\` text,
    \`isActive\` boolean NOT NULL DEFAULT true,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`recalls_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`recalls_recallNumber_unique\` UNIQUE(\`recallNumber\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`pricing_data\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`recallId\` int NOT NULL,
    \`platform\` enum('ebay','amazon','facebook') NOT NULL,
    \`listingTitle\` text,
    \`price\` decimal(10,2),
    \`condition\` varchar(64),
    \`listingUrl\` text,
    \`quantity\` int DEFAULT 1,
    \`fetchedAt\` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT \`pricing_data_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`msrp_data\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`recallId\` int NOT NULL,
    \`source\` varchar(64),
    \`msrpPrice\` decimal(10,2),
    \`productUrl\` text,
    \`productTitle\` text,
    \`fetchedAt\` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT \`msrp_data_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`profit_analysis\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`recallId\` int NOT NULL,
    \`avgUsedPrice\` decimal(10,2),
    \`ebayAvgPrice\` decimal(10,2),
    \`amazonAvgPrice\` decimal(10,2),
    \`fbAvgPrice\` decimal(10,2),
    \`ebayCount\` int DEFAULT 0,
    \`amazonCount\` int DEFAULT 0,
    \`fbCount\` int DEFAULT 0,
    \`totalCount\` int DEFAULT 0,
    \`refundValue\` decimal(10,2),
    \`msrpValue\` decimal(10,2),
    \`profitMargin\` decimal(8,4),
    \`profitAmount\` decimal(10,2),
    \`meetsThreshold\` boolean DEFAULT false,
    \`calculatedAt\` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT \`profit_analysis_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`profit_analysis_recallId_unique\` UNIQUE(\`recallId\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`sync_log\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`agency\` enum('CPSC','NHTSA','ALL') NOT NULL,
    \`status\` enum('running','success','error') NOT NULL DEFAULT 'running',
    \`recordsIngested\` int DEFAULT 0,
    \`errorMessage\` text,
    \`startedAt\` timestamp NOT NULL DEFAULT (now()),
    \`completedAt\` timestamp NULL,
    CONSTRAINT \`sync_log_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`reports\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`userId\` int NOT NULL,
    \`name\` varchar(256) NOT NULL,
    \`filters\` json,
    \`status\` enum('pending','ready','error') NOT NULL DEFAULT 'pending',
    \`format\` enum('csv','pdf') NOT NULL,
    \`fileUrl\` text,
    \`rowCount\` int DEFAULT 0,
    \`errorMessage\` text,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT \`reports_id\` PRIMARY KEY(\`id\`)
  )`,
];

for (const sql of statements) {
  try {
    await conn.query(sql);
    const match = sql.match(/CREATE TABLE IF NOT EXISTS `([^`]+)`/);
    console.log(`✓ Created/verified: ${match?.[1]}`);
  } catch (e) {
    console.error(`✗ Error: ${e.message}`);
  }
}

await conn.end();
console.log('\nAll tables created successfully.');
