'use strict';
const { execSync } = require('child_process');
const path = require('path');

// Secret patterns. Kept conservative to limit false positives.
const SECRET_PATTERNS = [
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key ID' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, label: 'Private key' },
  { re: /sk-[A-Za-z0-9]{20,}/, label: 'API secret key (sk-...)' },
  { re: /ghp_[A-Za-z0-9]{30,}/, label: 'GitHub personal access token' },
  { re: /AIza[0-9A-Za-z\-_]{30,}/, label: 'Google API key' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { re: /(?:secret|password|passwd|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i, label: 'Hardcoded credential' },
];

const DANGEROUS = [
  { re: /\beval\s*\(/, sev: 'high', label: 'Use of eval()',
    note: 'eval executes arbitrary strings as code — a classic injection vector.' },
  { re: /new\s+Function\s*\(/, sev: 'medium', label: 'new Function()',
    note: 'Dynamic code construction can enable injection.' },
  { re: /dangerouslySetInnerHTML/, sev: 'high', label: 'dangerouslySetInnerHTML',
    note: 'Renders raw HTML — XSS risk if the content is not sanitized.' },
  { re: /\.innerHTML\s*=/, sev: 'medium', label: 'innerHTML assignment',
    note: 'Writing unsanitized data to innerHTML can introduce XSS.' },
  { re: /document\.write\s*\(/, sev: 'low', label: 'document.write()',
    note: 'Can overwrite the page and enable injection; avoid in modern apps.' },
  { re: /child_process[\s\S]{0,40}\bexec\s*\([^)]*\+/, sev: 'high', label: 'Shell exec with string concatenation',
    note: 'Building shell commands from variables enables command injection.' },
  { re: /(query|execute)\s*\(\s*[`'"][^`'"]*\$\{/, sev: 'high', label: 'SQL built with template interpolation',
    note: 'Interpolating variables into SQL strings is an SQL-injection risk — use parameterized queries.' },
];

function run(ctx) {
  const out = [];
  const add = (sev, title, detail, file, suggestion) =>
    out.push({ category: 'security', severity: sev, title, detail, file, suggestion });

  // --- .env committed? ---------------------------------------------------
  const gitignore = ctx.files.find((f) => f.name === '.gitignore');
  const hasEnv = ctx.files.some((f) => f.name === '.env');
  if (hasEnv) {
    let ignored = false;
    if (gitignore) {
      const txt = ctx.readText(gitignore.abs) || '';
      ignored = /(^|\n)\s*\.env(\s|$|\*)/.test(txt) || /(^|\n)\s*\*\.env/.test(txt);
    }
    if (!ignored) {
      add('high', '.env not git-ignored',
        'A .env file exists but does not appear to be excluded in .gitignore. Secrets may be committed to your repository.',
        '.gitignore', 'Add ".env" (and ".env.*") to .gitignore, and rotate any secrets that were already committed.');
    }
  }

  // --- Secret + dangerous pattern scan ----------------------------------
  const scanExts = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.html', '.env'];
  const seenSecret = new Set();
  for (const f of ctx.files.filter((x) => scanExts.includes(x.ext))) {
    const src = ctx.readText(f.abs);
    if (src == null) continue;

    for (const p of SECRET_PATTERNS) {
      const m = src.match(p.re);
      if (m) {
        const key = p.label + '|' + f.rel;
        if (seenSecret.has(key)) continue;
        seenSecret.add(key);
        // .env files legitimately hold secrets; flag only if NOT a .env (those are caught above)
        const sev = f.ext === '.env' ? 'low' : 'critical';
        add(sev, `Possible secret in source: ${p.label}`,
          `${f.rel} appears to contain a ${p.label}. Secrets in source code are a major exposure risk.`,
          f.rel, 'Move it to an environment variable, rotate the exposed credential, and scrub it from git history.');
      }
    }

    for (const dp of DANGEROUS) {
      if (dp.re.test(src)) {
        add(dp.sev, dp.label, `${f.rel}: ${dp.note}`, f.rel,
          'Review this usage; sanitize inputs or switch to a safe API / parameterized query.');
      }
    }
  }

  // --- npm audit (uses the user's own npm + network) --------------------
  if (ctx.pkg && ctx.hasNodeModules) {
    try {
      const raw = execSync('npm audit --json', {
        cwd: ctx.root, timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 20 * 1024 * 1024,
      }).toString();
      const audit = JSON.parse(raw);
      const v = audit.metadata && audit.metadata.vulnerabilities;
      if (v) {
        const totals = [];
        for (const level of ['critical', 'high', 'moderate', 'low']) {
          if (v[level]) totals.push(`${v[level]} ${level}`);
        }
        if (totals.length) {
          const sev = v.critical ? 'critical' : v.high ? 'high' : v.moderate ? 'medium' : 'low';
          add(sev, 'Vulnerable dependencies (npm audit)',
            `npm audit reports: ${totals.join(', ')}. These are known CVEs in your installed packages.`,
            'package.json', 'Run "npm audit fix" (review breaking changes before "npm audit fix --force").');
        } else {
          add('info', 'No known dependency vulnerabilities', 'npm audit found no known CVEs. ', null, null);
        }
      }
    } catch (e) {
      // npm audit returns a non-zero exit code WHEN it finds vulns; parse stdout anyway.
      const stdout = (e.stdout && e.stdout.toString()) || '';
      try {
        const audit = JSON.parse(stdout);
        const v = audit.metadata && audit.metadata.vulnerabilities;
        if (v) {
          const totals = ['critical', 'high', 'moderate', 'low']
            .filter((l) => v[l]).map((l) => `${v[l]} ${l}`);
          if (totals.length) {
            const sev = v.critical ? 'critical' : v.high ? 'high' : v.moderate ? 'medium' : 'low';
            add(sev, 'Vulnerable dependencies (npm audit)',
              `npm audit reports: ${totals.join(', ')}. These are known CVEs in your installed packages.`,
              'package.json', 'Run "npm audit fix" and review the report.');
          }
        }
      } catch {
        add('info', 'npm audit could not run',
          'Could not run npm audit (npm not on PATH, no network, or no lockfile). Run it manually to check dependency CVEs.',
          null, 'Run "npm audit" in this folder.');
      }
    }
  }

  return out;
}

// Optional live header probe — called separately when the user supplies a URL.
async function probeHeaders(url) {
  const findings = [];
  const add = (sev, title, detail, suggestion) =>
    findings.push({ category: 'security', severity: sev, title, detail, file: url, suggestion });

  let res;
  try {
    res = await fetch(url, { redirect: 'manual' });
  } catch (e) {
    add('info', 'Live probe failed', `Could not reach ${url}: ${e.message}`, 'Make sure the app is running and the URL is correct.');
    return findings;
  }

  const h = (name) => res.headers.get(name);
  const checks = [
    ['content-security-policy', 'medium', 'Missing Content-Security-Policy',
      'No CSP header. CSP is a strong defense against XSS and data injection.',
      'Add a Content-Security-Policy header.'],
    ['x-content-type-options', 'low', 'Missing X-Content-Type-Options',
      'No X-Content-Type-Options: nosniff. Browsers may MIME-sniff responses.',
      'Set X-Content-Type-Options: nosniff.'],
    ['x-frame-options', 'medium', 'Missing X-Frame-Options',
      'No X-Frame-Options / frame-ancestors. The page can be framed (clickjacking risk).',
      'Set X-Frame-Options: DENY or a CSP frame-ancestors directive.'],
    ['strict-transport-security', 'medium', 'Missing HSTS',
      'No Strict-Transport-Security header. Connections can be downgraded to HTTP.',
      'Set Strict-Transport-Security on HTTPS responses.'],
  ];
  for (const [name, sev, title, detail, sugg] of checks) {
    if (!h(name)) add(sev, title, detail, sugg);
  }
  if (h('server')) {
    add('low', 'Server header discloses software',
      `The Server header reveals "${h('server')}". Version disclosure helps attackers target known CVEs.`,
      'Suppress or genericize the Server header.');
  }
  if (findings.length === 0) {
    add('info', 'Security headers look good', `All checked security headers are present on ${url}.`, null);
  }
  return findings;
}

module.exports = { run, probeHeaders, id: 'security', label: 'Security' };
