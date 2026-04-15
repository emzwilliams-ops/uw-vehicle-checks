import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let cache;

export async function getSampleData() {
  if (cache) return cache;
  const dir = dirname(fileURLToPath(import.meta.url));
  const path = resolve(dir, '../../../data/sample_reports.json');
  cache = JSON.parse(await readFile(path, 'utf8'));
  return cache;
}

export async function lookupSample(registration) {
  const data = await getSampleData();
  return data?.vehicles?.[registration] || null;
}
