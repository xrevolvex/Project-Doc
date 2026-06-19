# Project Doctor

A local web dashboard that audits your own projects end to end and tells you
what's broken, what's missing, where the risks are, and what's slow.

Built for **plain HTML/CSS/JS** sites and **React / Next.js + Node** projects.
Zero dependencies — it runs on Node's built-in modules only.

## What it checks

Modules run in priority order:

1. **Functionality** (deepest) — missing critical files (lockfile, .gitignore,
   README, .env.example), dependencies not installed, undeclared/unused
   dependencies, **broken imports**, broken local asset/link references in HTML,
   environment variables used but never defined, empty source files, TODO/FIXME
   tally.
2. **Database** — detects your ORM/driver (Prisma, Mongoose, Sequelize, Drizzle,
   pg, mysql, sqlite, Supabase, MongoDB), checks for a configured connection
   string, flags hardcoded connection strings, inspects the Prisma schema
   (missing primary keys, missing migrations, index hints), and SQL tables
   without primary keys.
3. **Security** — secret scanning in source, `.env` not git-ignored, dangerous
   patterns (`eval`, `dangerouslySetInnerHTML`, `innerHTML =`, shell exec with
   string concatenation, SQL built via template interpolation), and a live
   `npm audit` of installed dependencies. Optional **live header probe** checks
   CSP, HSTS, X-Frame-Options, X-Content-Type-Options on a running URL.
4. **Performance** — oversized images, very large source files, dependency
   bloat, missing production build, large unminified assets.

Each finding has a severity (critical / high / medium / low / info), the file
it relates to, and a suggested fix. The dashboard shows a health score, severity
counts, and category filters.

## Run it

```bash
cd project-doctor
npm start
```

Then open **http://localhost:4477**, paste a project folder path
(e.g. `/Users/erzan/projects/my-site`), and click **Run audit**.

To check live security headers, expand "Add a live URL probe", enter your
running app's URL (e.g. `http://localhost:3000`), and click **Probe headers**.

> Note: the audit reads files only. The live `npm audit` and header probe use
> your own machine's network. Nothing leaves your computer.

## Extend it

Each analyzer is a self-contained module in `lib/analyzers/` that exports
`run(ctx)` and returns an array of findings:

```js
{ category, severity, title, detail, file, suggestion }
```

`ctx` (built once in `lib/util.js`) gives you the file list, parsed
`package.json`, detected framework, a `fileExists()` helper, and `readText()`.
Add a new file, drop it into the `ANALYZERS` array in `lib/scanner.js`, and it
shows up in the dashboard automatically.

## Roadmap ideas

- Real runtime checks: boot the dev server, crawl routes, capture console errors
- Lighthouse integration for true performance/accessibility scores
- Live DB connection test with credentials from `.env`
- Export reports to Markdown / PDF
- Watch mode that re-audits on file change
- Per-client project profiles (save folder paths you scan often)
```
