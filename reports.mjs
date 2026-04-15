import { listRecentReports } from './lib/storage.mjs';
import { jsonResponse } from './lib/response.mjs';

export default async () => jsonResponse(await listRecentReports(8));
