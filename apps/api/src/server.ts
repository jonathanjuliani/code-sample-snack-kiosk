import { buildApp, loggerRedact, loggerSerializers } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase, readSeed, seedMenu } from './db/database.ts';

const config = loadConfig();
const db = openDatabase(config.DB_PATH);
seedMenu(db, readSeed(config.SEED_PATH));

const app = buildApp({
  db,
  config,
  logger: {
    level: config.LOG_LEVEL,
    redact: loggerRedact,
    serializers: loggerSerializers,
  },
});

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
