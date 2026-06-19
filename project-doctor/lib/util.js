'use strict';
const fs = require('fs');
const path = require('path');

// Directories we never descend into.
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.cache',
  '.turbo', '.vercel', 'coverage', '.parcel-cache', '.svelte-kit', 'vendor',
]);

const TEXT_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.html', '.htm', '.css',
  '.scss', '.sass', '.less', '.json', '.md', '.txt', '.env', '.yml', '.yaml',
  '.svg', '.vue', '.svelte', '.prisma', '.sql', '.graphql', '.sh',
]);

const NODE_BUILTINS = new Set([
  'fs', 'path', 'http', 'https', 'os', 'crypto', 'util', 'events', 'stream',
  'url', 'querystring', 'child_process', 'cluster', 'dns', 'net', 'tls',
  'zlib', 'readline', 'assert', 'buffer', 'console', 'process', 'timers',
  'string_decoder', 'module', 'vm', 'worker_threads', 'perf_hooks', 'async_hooks',
]);

const MAX_FILES = 20000;
const MAX_READ_BYTES = 2 * 1024 * 1024; // don't read files bigger than 2MB into memory

/**
 * Recursively walk a directory, returning file metadata.
 * Skips IGNORED_DIRS but records that they exist (for "installed?" checks).
 */
function walk(root) {
  const files = [];
  const skippedDirs = new Set();
  let count = 0;

  function recurse(dir) {
    if (count >= MAX_FILES) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          skippedDirs.add(entry.name);
          continue;
        }
        recurse(full);
      } else if (entry.isFile()) {
        if (count >= MAX_FILES) return;
        let size = 0;
        try { size = fs.statSync(full).size; } catch { /* ignore */ }
        files.push({
          abs: full,
          rel: path.relative(root, full),
          name: entry.name,
          ext: path.extname(entry.name).toLowerCase(),
          size,
        });
        count++;
      }
    }
  }
  recurse(root);
  return { files, skippedDirs };
}

function readText(absPath, maxBytes = MAX_READ_BYTES) {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > maxBytes) return null;
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function safeJSON(absPath) {
  const txt = readText(absPath);
  if (txt == null) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Build the shared analysis context once, hand it to every analyzer.
 */
function buildContext(root) {
  const { files, skippedDirs } = walk(root);
  const fileSet = new Set(files.map((f) => f.rel.split(path.sep).join('/')));

  const pkgFile = files.find((f) => f.rel === 'package.json');
  const pkg = pkgFile ? safeJSON(pkgFile.abs) : null;

  // Detect framework / stack.
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  let framework = 'static';
  if (deps.next) framework = 'next';
  else if (deps.react) framework = 'react';
  else if (deps.vue) framework = 'vue';
  else if (deps.svelte) framework = 'svelte';
  else if (deps.express || deps.fastify || deps.koa) framework = 'node-backend';
  else if (pkg) framework = 'node';
  else if (files.some((f) => f.ext === '.html')) framework = 'static';

  const hasNodeModules = skippedDirs.has('node_modules');

  return {
    root,
    files,
    fileSet,
    skippedDirs,
    pkg,
    deps,
    framework,
    hasNodeModules,
    readText,
    fileExists: (rel) => fileSet.has(rel.split(path.sep).join('/')),
    findings: [],
  };
}

module.exports = {
  walk, readText, safeJSON, buildContext, formatBytes,
  TEXT_EXTS, NODE_BUILTINS, IGNORED_DIRS,
};
