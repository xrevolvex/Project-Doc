'use strict';
const path = require('path');
const { NODE_BUILTINS, TEXT_EXTS } = require('../util');

// Resolve a relative import like './foo' against a source file's dir.
function resolveLocal(ctx, fromRel, spec) {
  const baseDir = path.posix.dirname(fromRel.split(path.sep).join('/'));
  let target = path.posix.normalize(path.posix.join(baseDir, spec));
  const candidates = [
    target,
    target + '.js', target + '.jsx', target + '.ts', target + '.tsx',
    target + '.mjs', target + '.cjs', target + '.json', target + '.vue', target + '.svelte',
    target + '.css', target + '.scss',
    target + '/index.js', target + '/index.jsx', target + '/index.ts', target + '/index.tsx',
  ];
  return candidates.some((c) => ctx.fileExists(c));
}

function run(ctx) {
  const out = [];
  const add = (sev, title, detail, file, suggestion) =>
    out.push({ category: 'functionality', severity: sev, title, detail, file, suggestion });

  const isNode = !!ctx.pkg;
  const has = (rel) => ctx.files.some((f) => f.rel === rel);

  // --- Missing critical files -------------------------------------------
  if (isNode) {
    const lock = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
    if (!lock.some(has)) {
      add('medium', 'No lockfile found',
        'No package-lock.json / yarn.lock / pnpm-lock.yaml. Installs are not reproducible — teammates and deploys may get different dependency versions.',
        'package.json', 'Run your installer once and commit the generated lockfile.');
    }
    if (ctx.pkg && !ctx.hasNodeModules) {
      add('critical', 'Dependencies not installed',
        'package.json exists but node_modules is missing. The app cannot run or build until dependencies are installed.',
        'package.json', 'Run "npm install" (or yarn / pnpm install) in this folder.');
    }
  }
  if (!has('.gitignore')) {
    add('low', 'No .gitignore',
      'Without a .gitignore you risk committing node_modules, build output, or secrets.',
      null, 'Add a .gitignore that excludes node_modules, dist/build, and .env files.');
  }
  if (!ctx.files.some((f) => /^readme/i.test(f.name))) {
    add('low', 'No README', 'No README found — onboarding and handoff are harder without one.', null,
      'Add a README describing setup, scripts, and environment variables.');
  }
  // .env present but example missing (or vice versa)
  const hasEnv = has('.env');
  const hasEnvExample = ctx.files.some((f) => /^\.env\.(example|sample|template)$/i.test(f.name));
  if (hasEnv && !hasEnvExample) {
    add('low', 'No .env.example',
      'A .env exists but there is no .env.example. New developers will not know which variables are required.',
      '.env', 'Create a .env.example listing variable names with placeholder values (no real secrets).');
  }

  // --- Build the dependency picture -------------------------------------
  const declared = new Set(Object.keys(ctx.deps));
  const usedExternal = new Set();
  const envVarsUsed = new Set();

  const importRe = /(?:import[\s\S]*?from\s*|import\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
  const envRe = /process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]|import\.meta\.env\.([A-Z0-9_]+)/g;

  const codeFiles = ctx.files.filter((f) =>
    ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(f.ext));

  let brokenImports = 0;
  for (const f of codeFiles) {
    const src = ctx.readText(f.abs);
    if (src == null) continue;

    let m;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(src))) {
      const spec = m[1];
      if (!spec) continue;
      if (spec.startsWith('.') || spec.startsWith('/')) {
        // local import — verify it resolves
        if (spec.startsWith('.') && !resolveLocal(ctx, f.rel, spec)) {
          brokenImports++;
          add('high', 'Broken import',
            `In ${f.rel}: imports "${spec}" but no matching file was found. This will throw at build/runtime.`,
            f.rel, 'Fix the path or create the missing module.');
        }
      } else {
        // external package — record the top-level package name
        const pkgName = spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0];
        if (!NODE_BUILTINS.has(pkgName) && !pkgName.startsWith('node:')) {
          usedExternal.add(pkgName);
        }
      }
    }

    envRe.lastIndex = 0;
    while ((m = envRe.exec(src))) {
      envVarsUsed.add(m[1] || m[2] || m[3]);
    }
  }

  // Missing dependencies (imported but not declared)
  if (isNode) {
    for (const used of usedExternal) {
      if (!declared.has(used)) {
        add('high', 'Undeclared dependency',
          `Package "${used}" is imported in code but not listed in package.json. Builds will fail on a clean install.`,
          'package.json', `Add "${used}" to your dependencies (npm install ${used}).`);
      }
    }
    // Unused dependencies (declared but never imported) — skip obvious tooling
    const toolingHints = /eslint|prettier|typescript|@types\/|vite|webpack|babel|tailwind|postcss|autoprefixer|nodemon|jest|vitest|husky|^react$|^react-dom$|^next$|^@next\/|sass|less|rollup|esbuild|concurrently/;
    for (const dep of declared) {
      if (!usedExternal.has(dep) && !toolingHints.test(dep)) {
        add('low', 'Possibly unused dependency',
          `"${dep}" is in package.json but was not found imported anywhere. It may be dead weight (or used dynamically).`,
          'package.json', `Confirm it is needed; if not, remove it to shrink install size.`);
      }
    }
  }

  // --- Env vars used but not defined ------------------------------------
  if (envVarsUsed.size && (hasEnv || hasEnvExample)) {
    const defined = new Set();
    for (const f of ctx.files.filter((x) => /^\.env/.test(x.name))) {
      const txt = ctx.readText(f.abs) || '';
      for (const line of txt.split('\n')) {
        const mm = line.match(/^\s*([A-Z0-9_]+)\s*=/);
        if (mm) defined.add(mm[1]);
      }
    }
    for (const v of envVarsUsed) {
      // Vite/Next public prefixes are sometimes injected at build; still worth flagging
      if (!defined.has(v)) {
        add('medium', 'Environment variable not defined',
          `Code reads "${v}" from the environment, but it is not present in any .env file. It will be undefined at runtime.`,
          null, `Add ${v} to your .env (and .env.example).`);
      }
    }
  }

  // --- Broken local asset references in HTML ----------------------------
  const htmlFiles = ctx.files.filter((f) => f.ext === '.html' || f.ext === '.htm');
  const attrRe = /(?:src|href)\s*=\s*['"]([^'"]+)['"]/g;
  for (const f of htmlFiles) {
    const src = ctx.readText(f.abs);
    if (src == null) continue;
    let m;
    attrRe.lastIndex = 0;
    while ((m = attrRe.exec(src))) {
      let ref = m[1].split('#')[0].split('?')[0];
      if (!ref) continue;
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith('mailto:') ||
          ref.startsWith('tel:') || ref.startsWith('data:') || ref.startsWith('#')) continue;
      const baseDir = path.posix.dirname(f.rel.split(path.sep).join('/'));
      const target = ref.startsWith('/')
        ? ref.replace(/^\//, '')
        : path.posix.normalize(path.posix.join(baseDir, ref));
      if (target && !ctx.fileExists(target) && !ctx.fileExists(target.replace(/\/$/, '/index.html'))) {
        add('high', 'Broken asset / link',
          `In ${f.rel}: references "${ref}" but that file does not exist in the project.`,
          f.rel, 'Fix the path or add the missing asset.');
      }
    }
  }

  // --- Empty source files -----------------------------------------------
  for (const f of codeFiles) {
    if (f.size === 0) {
      add('low', 'Empty source file', `${f.rel} is empty (0 bytes).`, f.rel,
        'Remove it or add its intended contents.');
    }
  }

  // --- TODO / FIXME tally (informational) -------------------------------
  let todos = 0;
  for (const f of codeFiles.concat(htmlFiles)) {
    const src = ctx.readText(f.abs);
    if (src == null) continue;
    const matches = src.match(/\b(TODO|FIXME|HACK|XXX)\b/g);
    if (matches) todos += matches.length;
  }
  if (todos > 0) {
    add('info', `${todos} TODO/FIXME marker${todos > 1 ? 's' : ''}`,
      `Found ${todos} TODO/FIXME/HACK markers across the codebase — unfinished work to review.`,
      null, 'Search the codebase for TODO/FIXME to see outstanding items.');
  }

  return out;
}

module.exports = { run, id: 'functionality', label: 'Functionality' };
