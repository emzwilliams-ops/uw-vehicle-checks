import { saveCaseDetails } from './lib/storage.mjs';
import { errorResponse, jsonResponse } from './lib/response.mjs';

export default async (request) => {
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const body = await request.json();
  if (!body.reportId) return errorResponse('Missing report id.', 400);
  const report = await saveCaseDetails(body.reportId, {
    claim_reference: body.claim_reference || '',
    claimant_name: body.claimant_name || '',
    incident_date: body.incident_date || '',
    incident_summary: body.incident_summary || '',
    notes: body.notes || '',
  });
  if (!report) return errorResponse('Report not found.', 404);
  return jsonResponse(report);
};
