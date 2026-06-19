'use strict';
const { buildContext } = require('./util');

const functionality = require('./analyzers/functionality');
const database = require('./analyzers/database');
const security = require('./analyzers/security');
const performance = require('./analyzers/performance');

// Priority order matches the user's ranking.
const ANALYZERS = [functionality, database, security, performance];

const SEVERITY_WEIGHT = { critical: 25, high: 12, medium: 5, low: 2, info: 0 };
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function scan(root) {
  const ctx = buildContext(root);
  let findings = [];

  for (const analyzer of ANALYZERS) {
    try {
      const results = analyzer.run(ctx) || [];
      findings = findings.concat(results);
    } catch (e) {
      findings.push({
        category: analyzer.id, severity: 'info',
        title: `${analyzer.label} analyzer error`,
        detail: `The ${analyzer.label} analyzer threw: ${e.message}`,
        file: null, suggestion: null,
      });
    }
  }

  // Sort: severity first, then category.
  findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) ||
    a.category.localeCompare(b.category));

  // Tally + score.
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let penalty = 0;
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
    penalty += SEVERITY_WEIGHT[f.severity] || 0;
  }
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    root,
    framework: ctx.framework,
    fileCount: ctx.files.length,
    hasNodeModules: ctx.hasNodeModules,
    score,
    counts,
    findings,
    scannedAt: new Date().toISOString(),
  };
}

async function probe(url) {
  return security.probeHeaders(url);
}

module.exports = { scan, probe };
