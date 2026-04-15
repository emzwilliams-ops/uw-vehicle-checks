const app = document.querySelector('#app');

const state = {
  reports: [],
  currentReport: null,
  error: '',
  message: '',
};

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const formatDateTime = (value = '') => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const route = () => {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/report/')) {
    return { name: 'report', id: path.split('/').filter(Boolean).at(-1) };
  }
  return { name: 'home' };
};

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(typeof data === 'string' ? data : data.error || 'Request failed');
  }
  return data;
};

const shell = (content, compact = false) => `
  <main class="layout ${compact ? 'narrow-layout' : ''}">
    <section class="hero ${compact ? 'compact' : ''}">
      <div class="hero-top">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true"><span></span></div>
          <div>
            <p class="eyebrow">CUVVA • INTERNAL</p>
            <h1>Underwriting <span class="accent-text">Intelligence</span></h1>
            <p class="lede">Opensource vehicle research</p>
          </div>
        </div>
        <div class="hero-side"><div class="prototype-pill">PROTOTYPE</div></div>
      </div>
      ${content}
    </section>
  </main>
`;

function attachLinks() {
  document.querySelectorAll('[data-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(link.getAttribute('href'));
    });
  });
}

function renderHome() {
  const cards = state.reports.length
    ? state.reports.map((item) => `
        <a class="report-card" href="/report/${item.id}" data-link>
          <span>${escapeHtml(item.claim_reference || 'No claim reference')}</span>
          <strong>${escapeHtml(item.registration)}</strong>
          <small>${escapeHtml(item.summary?.make || 'Unknown make')} ${escapeHtml(item.summary?.model || '')}</small>
          <p>${escapeHtml((item.headline_flags || []).join(' • ') || 'No headline flags yet')}</p>
          <small>${escapeHtml(formatDateTime(item.created_at))}</small>
        </a>
      `).join('')
    : '<p class="empty-state">No saved reports yet. Search a registration to create the first one.</p>';

  app.innerHTML = shell(`
    ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}
    ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ''}
    <form class="search-form" id="search-form">
      <label>
        <span class="eyebrow">UK Registration</span>
        <div class="search-row">
          <input name="registration" placeholder="AB12 CDE" autocomplete="off" required />
          <button type="submit">Build report</button>
        </div>
      </label>
      <p class="field-help">Searches live DVLA, MOT, and open-web sources when credentials are connected, and falls back to the included demo vehicle when needed.</p>
    </form>
    <section class="panel">
      <div class="panel-header"><div><p class="eyebrow">Saved reports</p><h2>Recent casework</h2></div></div>
      <div class="report-grid">${cards}</div>
    </section>
    <p class="footer-note">This report is a research aid. It surfaces public and official vehicle-related signals, not liability or ownership conclusions.</p>
  `, true);

  document.querySelector('#search-form')?.addEventListener('submit', handleSearchSubmit);
  attachLinks();
}

function renderReport() {
  const report = state.currentReport;
  if (!report) {
    app.innerHTML = shell('<div class="panel"><p>Loading report…</p></div>');
    return;
  }

  const summaryItems = [
    ['Registration', report.vehicle_summary.registration],
    ['Make', report.vehicle_summary.make],
    ['Model', report.vehicle_summary.model],
    ['Fuel type', report.vehicle_summary.fuel_type],
    ['Year', report.vehicle_summary.year_of_manufacture],
    ['Colour', report.vehicle_summary.colour],
    ['MOT status', report.vehicle_summary.mot_status],
    ['Tax status', report.vehicle_summary.tax_status],
  ].map(([label, value]) => `<div class="summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 'Unknown')}</strong></div>`).join('');

  const flags = (report.research_flags || []).map((flag) => `
    <article class="flag severity-${String(flag.severity || 'low').toLowerCase()}">
      <span>${escapeHtml(flag.severity || 'Low')}</span>
      <h3>${escapeHtml(flag.title)}</h3>
      <p>${escapeHtml(flag.detail)}</p>
    </article>
  `).join('');

  const mot = (report.mot_history || []).map((item) => `
    <article class="timeline-card">
      <h3>${escapeHtml(item.date)} <span>${escapeHtml(item.result)}</span></h3>
      <p>Mileage: ${escapeHtml(item.mileage || '-')}</p>
      <ul>${(item.items || []).map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>
    </article>
  `).join('');

  const recalls = (report.recalls || []).map((item) => `
    <article class="source-card">
      <span>${escapeHtml(item.status || 'Unknown')}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.why_it_matters || '')}</p>
      <a href="${escapeHtml(item.source_url || '#')}" target="_blank" rel="noreferrer">Open source</a>
    </article>
  `).join('');

  const findings = (report.web_findings || []).map((item, index) => `
    <article class="source-card">
      <span>${escapeHtml(item.type || 'Finding')} • ${escapeHtml(item.confidence || 'Unknown')}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.excerpt || '')}</p>
      <div class="action-row">
        <a class="action-link secondary-button" href="${escapeHtml(item.source_url || '#')}" target="_blank" rel="noreferrer">Open source</a>
        <button type="button" class="secondary-button snapshot-button" data-source-url="${escapeHtml(item.source_url || '')}" data-source-title="${escapeHtml(item.title || `Finding ${index + 1}`)}">Save snapshot</button>
      </div>
    </article>
  `).join('');

  const snapshots = (report.snapshots || []).map((item) => `
    <article class="snapshot-card">
      <span>${escapeHtml(formatDateTime(item.created_at))}</span>
      <h3>${escapeHtml(item.source_title)}</h3>
      <p>${escapeHtml(item.body_excerpt)}</p>
      <div class="action-row">
        <a class="action-link secondary-button" href="/api/snapshot-open?id=${encodeURIComponent(item.id)}" target="_blank" rel="noreferrer">Open saved copy</a>
        <a href="${escapeHtml(item.source_url)}" target="_blank" rel="noreferrer">Original source</a>
      </div>
    </article>
  `).join('');

  const statuses = (report.data_sources || []).map((item) => {
    const klass = item.status?.startsWith('Live') ? 'status-live' : item.status?.startsWith('Credentials') ? 'status-credentials' : item.status?.startsWith('Error') ? 'status-error' : '';
    return `<article class="status-card"><span>${escapeHtml(item.name)}</span><div class="status-badge ${klass}">${escapeHtml(item.status)}</div><p>${escapeHtml(item.purpose)}</p></article>`;
  }).join('');

  const caseDetails = report.case_details || {};

  app.innerHTML = shell(`
    <div class="page-toolbar">
      <a class="back-link" href="/" data-link>← Back to searches</a>
      <div class="action-row">
        <a class="action-link secondary-button" href="/api/export?id=${encodeURIComponent(report.meta.id)}" target="_blank" rel="noreferrer">Download CSV</a>
        <button type="button" class="secondary-button" id="print-report">Print / Save PDF</button>
      </div>
    </div>
    ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}
    ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ''}
    <section class="panel"><div class="panel-header"><div><p class="eyebrow">Vehicle summary</p><h2>${escapeHtml(report.meta.registration)}</h2><p>${escapeHtml(report.vehicle_summary.notes || '')}</p></div></div><div class="summary-grid">${summaryItems}</div></section>
    <section class="panel"><div class="panel-header"><div><p class="eyebrow">Claims relevance</p><h2>Research flags</h2></div></div><div class="flag-grid">${flags}</div></section>
    <section class="panel"><div class="panel-header"><div><p class="eyebrow">Data source status</p><h2>Connected services</h2></div></div><div class="status-grid">${statuses}</div></section>
    <div class="two-column">
      <section class="panel"><div class="panel-header"><div><p class="eyebrow">MOT timeline</p><h2>Inspection history</h2></div></div><div class="timeline">${mot}</div></section>
      <section class="panel"><div class="panel-header"><div><p class="eyebrow">Recall checks</p><h2>Safety follow-up</h2></div></div><div class="stack">${recalls}</div></section>
    </div>
    <div class="two-column">
      <section class="panel"><div class="panel-header"><div><p class="eyebrow">Open-web findings</p><h2>Listings, auctions, mentions and photos</h2></div></div><div class="stack">${findings}</div></section>
      <section class="panel"><div class="panel-header"><div><p class="eyebrow">Saved evidence</p><h2>Snapshots</h2></div></div><div class="stack">${snapshots || '<p class="empty-state">No saved snapshots yet. Save anything worth keeping in the file.</p>'}</div></section>
    </div>
    <section class="panel">
      <div class="panel-header"><div><p class="eyebrow">Case notes</p><h2>File details</h2></div></div>
      <form class="notes-form" id="notes-form">
        <div class="field-grid">
          <label><span>Claim reference</span><input name="claim_reference" value="${escapeHtml(caseDetails.claim_reference || '')}" /></label>
          <label><span>Claimant or file name</span><input name="claimant_name" value="${escapeHtml(caseDetails.claimant_name || '')}" /></label>
          <label><span>Incident date</span><input name="incident_date" type="date" value="${escapeHtml(caseDetails.incident_date || '')}" /></label>
        </div>
        <label><span>Incident summary</span><textarea name="incident_summary">${escapeHtml(caseDetails.incident_summary || '')}</textarea></label>
        <label><span>Internal notes</span><textarea name="notes">${escapeHtml(caseDetails.notes || '')}</textarea></label>
        <button type="submit">Save case notes</button>
      </form>
    </section>
    <p class="footer-note">${escapeHtml(report.disclaimer || '')}</p>
  `);

  document.querySelector('#notes-form')?.addEventListener('submit', handleNotesSubmit);
  document.querySelector('#print-report')?.addEventListener('click', () => window.print());
  document.querySelectorAll('.snapshot-button').forEach((button) => button.addEventListener('click', handleSnapshotSave));
  attachLinks();
}

async function loadHome() {
  state.error = '';
  try {
    state.reports = await api('/api/reports');
  } catch (error) {
    state.error = error.message;
  }
  renderHome();
}

async function loadReport(id) {
  state.error = '';
  renderReport();
  try {
    state.currentReport = await api(`/api/report?id=${encodeURIComponent(id)}`);
  } catch (error) {
    state.error = error.message;
  }
  renderReport();
}

async function handleSearchSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Building…';
  state.error = '';
  state.message = '';
  try {
    const data = await api('/api/search', { method: 'POST', body: JSON.stringify({ registration: form.get('registration') }) });
    navigate(`/report/${data.report.meta.id}`);
  } catch (error) {
    state.error = error.message;
    renderHome();
  } finally {
    button.disabled = false;
    button.textContent = 'Build report';
  }
}

async function handleNotesSubmit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    state.currentReport = await api('/api/notes', { method: 'POST', body: JSON.stringify({ reportId: state.currentReport.meta.id, ...payload }) });
    state.message = 'Case notes saved.';
  } catch (error) {
    state.error = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Save case notes';
    renderReport();
  }
}

async function handleSnapshotSave(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    state.currentReport = await api('/api/snapshot', {
      method: 'POST',
      body: JSON.stringify({ reportId: state.currentReport.meta.id, sourceUrl: button.dataset.sourceUrl, sourceTitle: button.dataset.sourceTitle }),
    });
    state.message = 'Snapshot saved.';
  } catch (error) {
    state.error = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Save snapshot';
    renderReport();
  }
}

function navigate(path) {
  window.history.pushState({}, '', path);
  hydrate();
}

async function hydrate() {
  state.message = '';
  const current = route();
  if (current.name === 'report') {
    await loadReport(current.id);
    return;
  }
  await loadHome();
}

window.addEventListener('popstate', hydrate);
hydrate();
