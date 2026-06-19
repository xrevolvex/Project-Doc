'use strict';

function run(ctx) {
  const out = [];
  const add = (sev, title, detail, file, suggestion) =>
    out.push({ category: 'database', severity: sev, title, detail, file, suggestion });

  const d = ctx.deps;
  const detected = [];
  if (d.prisma || d['@prisma/client']) detected.push('Prisma');
  if (d.mongoose) detected.push('Mongoose');
  if (d.sequelize) detected.push('Sequelize');
  if (d['drizzle-orm']) detected.push('Drizzle');
  if (d.knex) detected.push('Knex');
  if (d.typeorm) detected.push('TypeORM');
  if (d.pg || d.postgres) detected.push('PostgreSQL (pg)');
  if (d.mysql || d.mysql2) detected.push('MySQL');
  if (d['better-sqlite3'] || d.sqlite3) detected.push('SQLite');
  if (d['@supabase/supabase-js']) detected.push('Supabase');
  if (d.mongodb) detected.push('MongoDB driver');

  const sqlFiles = ctx.files.filter((f) => f.ext === '.sql');
  const prismaSchema = ctx.files.find((f) => f.name === 'schema.prisma');

  if (!detected.length && !sqlFiles.length && !prismaSchema) {
    add('info', 'No database layer detected',
      'No ORM, database driver, or .sql files were found. If this project is meant to use a database, the connection may be missing.',
      null, 'If a DB is expected, confirm the driver/ORM is installed and configured.');
    return out;
  }

  if (detected.length) {
    add('info', 'Database layer detected',
      `Found: ${detected.join(', ')}.`, null, null);
  }

  // --- Connection string handling ---------------------------------------
  // Look for a DB URL referenced in code/env.
  const envFiles = ctx.files.filter((f) => /^\.env/.test(f.name));
  let dbUrlDefined = false;
  let hardcodedConn = null;
  const connRe = /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s'"`]+/i;

  for (const f of envFiles) {
    const txt = ctx.readText(f.abs) || '';
    if (/DATABASE_URL|DB_URL|MONGO_URI|POSTGRES_URL/i.test(txt)) dbUrlDefined = true;
  }
  for (const f of ctx.files.filter((x) =>
    ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs'].includes(x.ext))) {
    const src = ctx.readText(f.abs);
    if (src == null) continue;
    const m = src.match(connRe);
    if (m && !/process\.env/.test(src.slice(Math.max(0, m.index - 40), m.index))) {
      hardcodedConn = f.rel;
      break;
    }
  }

  if (hardcodedConn) {
    add('critical', 'Hardcoded database connection string',
      `A database URL appears hardcoded in ${hardcodedConn}. Credentials in source are a serious leak risk, especially if committed to git.`,
      hardcodedConn, 'Move the connection string into an environment variable (DATABASE_URL) and load it from .env.');
  }

  if ((detected.includes('Prisma') || detected.some((x) => /Postgre|MySQL|Mongo/.test(x))) && !dbUrlDefined && !hardcodedConn) {
    add('high', 'No database connection string configured',
      'A database layer is present, but no DATABASE_URL / connection string was found in your .env files. The app cannot connect.',
      null, 'Add the connection string to .env (e.g. DATABASE_URL=...).');
  }

  // --- Prisma schema inspection -----------------------------------------
  if (prismaSchema) {
    const schema = ctx.readText(prismaSchema.abs) || '';
    const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
    let m;
    let modelCount = 0;
    while ((m = modelRe.exec(schema))) {
      modelCount++;
      const name = m[1];
      const body = m[2];
      if (!/@id\b/.test(body) && !/@@id\b/.test(body)) {
        add('high', `Model "${name}" has no primary key`,
          `The Prisma model ${name} defines no @id / @@id. Prisma requires a unique identifier per model.`,
          'prisma/schema.prisma', `Add an @id field (e.g. id Int @id @default(autoincrement())) to ${name}.`);
      }
      // relation fields without an index hint
      const relFields = body.match(/\w+\s+\w+(\[\])?\s+@relation/g);
      if (relFields && !/@@index/.test(body)) {
        add('low', `Model "${name}" relations may lack indexes`,
          `${name} has relation fields but no @@index. Foreign-key lookups can be slow at scale without indexes.`,
          'prisma/schema.prisma', `Consider adding @@index on frequently-queried foreign keys in ${name}.`);
      }
    }
    if (modelCount === 0) {
      add('medium', 'Prisma schema has no models',
        'schema.prisma exists but defines no models — the data layer is effectively empty.',
        'prisma/schema.prisma', 'Define your models, then run prisma migrate.');
    }
    const hasMigrations = ctx.files.some((f) => /prisma[\\/]migrations[\\/]/.test(f.rel));
    if (modelCount > 0 && !hasMigrations) {
      add('medium', 'No Prisma migrations found',
        'Models are defined but there is no migrations folder. The database schema may not be in sync with your code.',
        null, 'Run "npx prisma migrate dev" to generate and apply migrations.');
    }
  }

  // --- Raw SQL smells ----------------------------------------------------
  for (const f of sqlFiles) {
    const sql = (ctx.readText(f.abs) || '').toUpperCase();
    if (/CREATE TABLE/.test(sql) && !/PRIMARY KEY/.test(sql)) {
      add('medium', 'SQL table without primary key',
        `${f.rel} defines a table but no PRIMARY KEY was found. Tables without a primary key are hard to update reliably and replicate poorly.`,
        f.rel, 'Add a PRIMARY KEY to each table.');
    }
  }

  // --- Live connection note ---------------------------------------------
  add('info', 'Live connection test available separately',
    'Static analysis cannot verify the database actually responds. Use the "Live probe" field with your running app URL, or wire real credentials for a runtime check.',
    null, null);

  return out;
}

module.exports = { run, id: 'database', label: 'Database' };
