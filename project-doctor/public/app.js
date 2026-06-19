'use strict';

const $ = (id) => document.getElementById(id);
let currentReport = null;
let activeCat = 'all';

const SEV_LABEL = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'info' };

function setStatus(msg, kind) {
  const el = $('status');
  el.hidden = false;
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.innerHTML = kind === 'loading'
    ? `${msg}<span class="dots"></span>`
    : msg;
}
function clearStatus() { $('status').hidden = true; }

async function runScan() {
  const folder = $('folder').value.trim();
  if (!folder) { setStatus('Enter a project folder path first.', 'error'); return; }
  $('run').disabled = true;
  setStatus('Auditing ' + folder, 'loading');
  try {
    const res = await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    });
    const data = await res.json();
    if (!res.ok) { setStatus(data.error || 'Scan failed.', 'error'); return; }
    currentReport = data;
    clearStatus();
    renderReport(data);
  } catch (e) {
    setStatus('Could not reach the local server: ' + e.message, 'error');
  } finally {
    $('run').disabled = false;
  }
}

async function runProbe() {
  const target = $('probe-url').value.trim();
  if (!target) { setStatus('Enter the running app URL first.', 'error'); return; }
  setStatus('Probing headers at ' + target, 'loading');
  try {
    const res = await fetch('/api/probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    });
    const data = await res.json();
    if (!res.ok) { setStatus(data.error || 'Probe failed.', 'error'); return; }
    clearStatus();
    if (currentReport) {
      currentReport.findings = currentReport.findings
        .filter((f) => !(f.category === 'security' && f.file && /^https?:/.test(f.file)))
        .concat(data.findings);
      recount(currentReport);
      renderReport(currentReport);
    } else {
      currentReport = {
        framework: '—', fileCount: 0, score: null,
        counts: tally(data.findings), findings: data.findings,
        scannedAt: new Date().toISOString(),
      };
      renderReport(currentReport);
    }
  } catch (e) {
    setStatus('Probe error: ' + e.message, 'error');
  }
}

function tally(findings) {
  const c = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  findings.forEach((f) => { c[f.severity] = (c[f.severity] || 0) + 1; });
  return c;
}
function recount(report) { report.counts = tally(report.findings); }

function renderReport(report) {
  // Summary
  $('summary').hidden = false;
  $('filters').hidden = false;
  const ring = $('ring');
  if (report.score == null) {
    $('score-num').textContent = '—';
    ring.style.setProperty('--p', 0);
  } else {
    $('score-num').textContent = report.score;
    ring.style.setProperty('--p', report.score);
    const color = report.score >= 80 ? 'var(--low)'
      : report.score >= 55 ? 'var(--high)' : 'var(--crit)';
    ring.style.setProperty('--ring-color', color);
  }
  $('m-stack').textContent = report.framework || '—';
  $('m-files').textContent = report.fileCount != null ? report.fileCount : '—';
  $('m-time').textContent = new Date(report.scannedAt).toLocaleTimeString();

  // Chips
  const chips = $('chips');
  chips.innerHTML = '';
  ['critical', 'high', 'medium', 'low', 'info'].forEach((sev) => {
    const n = report.counts[sev] || 0;
    if (n === 0 && sev === 'info') return;
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<span class="dot ${sev}"></span><span class="n">${n}</span> ${SEV_LABEL[sev]}`;
    chips.appendChild(chip);
  });

  renderFindings();
}

function renderFindings() {
  const wrap = $('findings');
  wrap.innerHTML = '';
  const list = currentReport.findings.filter(
    (f) => activeCat === 'all' || f.category === activeCat);

  if (!list.length) {
    wrap.innerHTML = '<div class="empty">No findings in this category. </div>';
    return;
  }
  list.forEach((f, i) => {
    const card = document.createElement('article');
    card.className = 'finding ' + f.severity;
    card.style.animationDelay = (i * 0.025) + 's';
    card.innerHTML = `
      <div class="finding-head">
        <span class="tag ${f.severity}">${SEV_LABEL[f.severity]}</span>
        <h3>${esc(f.title)}</h3>
        <span class="cat-label">${esc(f.category)}</span>
      </div>
      ${f.detail ? `<p>${esc(f.detail)}</p>` : ''}
      ${f.file ? `<span class="file">${esc(f.file)}</span>` : ''}
      ${f.suggestion ? `<div class="fix"><b>Suggested fix</b>${esc(f.suggestion)}</div>` : ''}
    `;
    wrap.appendChild(card);
  });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// --- Wire up events -----------------------------------------------------
$('run').addEventListener('click', runScan);
$('folder').addEventListener('keydown', (e) => { if (e.key === 'Enter') runScan(); });
$('probe').addEventListener('click', runProbe);
$('probe-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') runProbe(); });
$('toggle-probe').addEventListener('click', () => {
  const row = $('probe-row');
  row.hidden = !row.hidden;
  $('toggle-probe').textContent = row.hidden
    ? '+ Add a live URL probe (optional)'
    : '− Hide live URL probe';
});
document.querySelectorAll('.cat').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeCat = btn.dataset.cat;
    if (currentReport) renderFindings();
  });
});
