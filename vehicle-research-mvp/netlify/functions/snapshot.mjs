import { captureSnapshot } from './lib/research.mjs';
import { saveSnapshot } from './lib/storage.mjs';
import { errorResponse, jsonResponse } from './lib/response.mjs';

export default async (request) => {
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  try {
    const body = await request.json();
    if (!body.reportId || !body.sourceUrl) return errorResponse('Missing report id or source URL.', 400);
    const snapshot = await captureSnapshot(body.sourceUrl);
    const report = await saveSnapshot(body.reportId, {
      sourceUrl: body.sourceUrl,
      sourceTitle: body.sourceTitle || 'Untitled source',
      contentType: snapshot.contentType,
      body: snapshot.body,
      bodyExcerpt: snapshot.bodyExcerpt,
    });
    if (!report) return errorResponse('Report not found.', 404);
    return jsonResponse(report);
  } catch (error) {
    return errorResponse(error.message || 'Could not save snapshot.', 502);
  }
};
