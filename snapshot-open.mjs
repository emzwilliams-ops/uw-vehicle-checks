import { getSnapshot } from './lib/storage.mjs';

export default async (request) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return new Response('Missing snapshot id.', { status: 400 });
  const snapshot = await getSnapshot(id);
  if (!snapshot) return new Response('Snapshot not found.', { status: 404 });
  return new Response(snapshot.body, {
    status: 200,
    headers: {
      'content-type': snapshot.content_type || 'text/plain; charset=utf-8',
      'content-disposition': `inline; filename="${snapshot.id}.txt"`,
    },
  });
};
