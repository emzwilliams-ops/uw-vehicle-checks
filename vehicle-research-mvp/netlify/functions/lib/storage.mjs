import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const reportStore = () => getStore('uw-reports');
const snapshotStore = () => getStore('uw-snapshots');
const RECENT_KEY = 'recent';

const emptyCaseDetails = () => ({
  claim_reference: '',
  claimant_name: '',
  incident_date: '',
  incident_summary: '',
  notes: '',
  updated_at: '',
});

const recentSummary = (report) => ({
  id: report.meta.id,
  registration: report.meta.registration,
  created_at: report.meta.created_at,
  summary: report.vehicle_summary,
  headline_flags: report.headline_flags || [],
  claim_reference: report.case_details?.claim_reference || '',
});

async function getRecentIndex() {
  return (await reportStore().get(RECENT_KEY, { type: 'json' })) || [];
}

async function setRecentIndex(items) {
  await reportStore().setJSON(RECENT_KEY, items.slice(0, 25));
}

async function syncRecentIndex(report) {
  const recent = await getRecentIndex();
  await setRecentIndex([recentSummary(report), ...recent.filter((item) => item.id !== report.meta.id)]);
}

export async function saveReport(registration, payload) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const report = { ...payload, meta: { id, registration, created_at: createdAt }, case_details: emptyCaseDetails(), snapshots: [] };
  await reportStore().setJSON(`report:${id}`, report, { metadata: { registration, createdAt } });
  await syncRecentIndex(report);
  return report;
}

export async function getReport(reportId) {
  return reportStore().get(`report:${reportId}`, { type: 'json' });
}

export async function listRecentReports(limit = 8) {
  return (await getRecentIndex()).slice(0, limit);
}

export async function saveCaseDetails(reportId, details) {
  const report = await getReport(reportId);
  if (!report) return null;
  const next = { ...report, case_details: { ...emptyCaseDetails(), ...(report.case_details || {}), ...details, updated_at: new Date().toISOString() } };
  await reportStore().setJSON(`report:${reportId}`, next, { metadata: { registration: next.meta.registration, createdAt: next.meta.created_at } });
  await syncRecentIndex(next);
  return next;
}

export async function saveSnapshot(reportId, snapshotInput) {
  const report = await getReport(reportId);
  if (!report) return null;
  const snapshotId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const snapshot = {
    id: snapshotId,
    report_id: reportId,
    source_url: snapshotInput.sourceUrl,
    source_title: snapshotInput.sourceTitle,
    content_type: snapshotInput.contentType,
    body: snapshotInput.body,
    body_excerpt: snapshotInput.bodyExcerpt,
    content_hash: crypto.createHash('sha256').update(snapshotInput.body, 'utf8').digest('hex'),
    created_at: createdAt,
  };
  await snapshotStore().setJSON(`snapshot:${snapshotId}`, snapshot, { metadata: { reportId, createdAt } });
  const next = {
    ...report,
    snapshots: [
      {
        id: snapshot.id,
        source_url: snapshot.source_url,
        source_title: snapshot.source_title,
        content_type: snapshot.content_type,
        body_excerpt: snapshot.body_excerpt,
        content_hash: snapshot.content_hash,
        created_at: snapshot.created_at,
      },
      ...(report.snapshots || []),
    ],
  };
  await reportStore().setJSON(`report:${reportId}`, next, { metadata: { registration: next.meta.registration, createdAt: next.meta.created_at } });
  await syncRecentIndex(next);
  return next;
}

export async function getSnapshot(snapshotId) {
  return snapshotStore().get(`snapshot:${snapshotId}`, { type: 'json' });
}
