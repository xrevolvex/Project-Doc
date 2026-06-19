'use strict';
const { formatBytes } = require('../util');

const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff'];

function run(ctx) {
  const out = [];
  const add = (sev, title, detail, file, suggestion) =>
    out.push({ category: 'performance', severity: sev, title, detail, file, suggestion });

  // --- Oversized images --------------------------------------------------
  for (const f of ctx.files.filter((x) => IMG_EXTS.includes(x.ext))) {
    if (f.size > 1024 * 1024) {
      add('medium', 'Oversized image',
        `${f.rel} is ${formatBytes(f.size)}. Large images slow page loads and hurt mobile users.`,
        f.rel, 'Compress it and/or serve a modern format (WebP/AVIF) with responsive sizes.');
    } else if (f.size > 400 * 1024 && (f.ext === '.png' || f.ext === '.jpg' || f.ext === '.jpeg')) {
      add('low', 'Heavy image',
        `${f.rel} is ${formatBytes(f.size)}. Consider WebP/AVIF to cut weight.`,
        f.rel, 'Convert to WebP/AVIF and compress.');
    }
  }

  // --- Large source / asset files ---------------------------------------
  for (const f of ctx.files.filter((x) =>
    ['.js', '.jsx', '.ts', '.tsx', '.css', '.json'].includes(x.ext))) {
    if (f.size > 700 * 1024) {
      add('medium', 'Very large source file',
        `${f.rel} is ${formatBytes(f.size)}. Big single files bloat bundles and slow parsing.`,
        f.rel, 'Split it into modules, or lazy-load/code-split this chunk.');
    }
  }

  // --- Dependency bloat --------------------------------------------------
  const depCount = Object.keys(ctx.deps).length;
  if (depCount > 60) {
    add('low', 'High dependency count',
      `package.json declares ${depCount} dependencies. Large trees increase install time, attack surface, and bundle size.`,
      'package.json', 'Audit for packages you can drop or replace with lighter alternatives.');
  }

  // --- Build output present? --------------------------------------------
  if (ctx.framework === 'next') {
    if (!ctx.skippedDirs.has('.next') && !ctx.skippedDirs.has('out')) {
      add('info', 'No Next.js build output',
        'No .next/ or out/ directory found. Run a production build to measure real bundle sizes.',
        null, 'Run "npm run build" to generate and inspect the production bundle.');
    }
  }

  // --- Unminified inline scripts in static sites ------------------------
  if (ctx.framework === 'static') {
    for (const f of ctx.files.filter((x) => x.ext === '.css' || x.ext === '.js')) {
      if (f.size > 150 * 1024 && !/\.min\./.test(f.name)) {
        add('low', 'Large unminified asset',
          `${f.rel} (${formatBytes(f.size)}) is not minified. Minification reduces transfer size.`,
          f.rel, 'Minify CSS/JS for production.');
      }
    }
  }

  if (out.length === 0) {
    add('info', 'No obvious performance issues',
      'No oversized assets, bloated files, or dependency bloat were detected in static analysis.',
      null, null);
  }

  return out;
}

module.exports = { run, id: 'performance', label: 'Performance' };
