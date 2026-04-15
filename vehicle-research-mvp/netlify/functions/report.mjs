import { getReport } from './lib/storage.mjs';
import { errorResponse, jsonResponse } from './lib/response.mjs';

export default async (request) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return errorResponse('Missing report id.', 400);
  const report = await getReport(id);
  if (!report) return errorResponse('Report not found.', 404);
  return jsonResponse(report);
};
