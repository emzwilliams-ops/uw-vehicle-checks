import { getReport } from './lib/storage.mjs';
import { exportReportCsv } from './lib/research.mjs';

export default async (request) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return new Response('Missing report id.', { status: 400 });
  const report = await getReport(id);
  if (!report) return new Response('Report not found.', { status: 404 });
  return new Response(exportReportCsv(report), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${report.meta.registration.toLowerCase()}-report.csv"`,
    },
  });
};
