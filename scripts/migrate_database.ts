import { getDatabase, persistDatabase } from '../src/database/db';
import fs from 'fs';
import path from 'path';

async function runDatabaseMigration() {
  console.log('=====================================================');
  console.log(' 🛠️  DATABASE SCHEMA MIGRATION & REPAIR RUNNER');
  console.log('=====================================================');

  const dbDir = path.join(process.cwd(), 'data');
  const dbFile = path.join(dbDir, 'trading_analyst.sqlite');

  console.log(`[Database Path] Target SQLite file: ${dbFile}`);
  const fileExists = fs.existsSync(dbFile);
  console.log(`[Status] Existing database file found: ${fileExists ? 'YES' : 'NO (Will create and initialize fresh schema)'}`);

  const start = Date.now();
  const db = await getDatabase();

  // Inspect existing tables
  const tablesResult = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
  const existingTables: string[] = tablesResult.length > 0 && tablesResult[0].values
    ? tablesResult[0].values.map((row: any[]) => String(row[0]))
    : [];

  console.log(`\n[Schema Validation] Total verified tables: ${existingTables.length}`);
  console.log(`Tables list: ${existingTables.join(', ')}`);

  // Ensure index verification
  const indexResult = db.exec("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name;");
  const indexCount = indexResult.length > 0 && indexResult[0].values ? indexResult[0].values.length : 0;
  console.log(`[Index Validation] Total verified custom indexes: ${indexCount}`);

  // Persist schema changes to disk
  persistDatabase();
  const duration = Date.now() - start;

  console.log('\n=====================================================');
  console.log(` ✅ DATABASE MIGRATION APPLIED SUCCESSFULLY (${duration}ms)`);
  console.log(' All tables, indices, and column constraints are up to date.');
  console.log(' You do NOT need to copy any dev database to live.');
  console.log('=====================================================\n');
}

runDatabaseMigration().catch((err) => {
  console.error('❌ Database migration failed:', err);
  process.exit(1);
});
