import { buildReport } from './lib/research.mjs';
import { saveReport } from './lib/storage.mjs';
import { errorResponse, jsonResponse } from './lib/response.mjs';

export default async (request) => {
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  try {
    const body = await request.json();
    const payload = await buildReport(body.registration || '');
    const report = await saveReport(payload.registration, payload);
    return jsonResponse({ report }, 201);
  } catch (error) {
    return errorResponse(error.message || 'Could not build report.', 400);
  }
};
