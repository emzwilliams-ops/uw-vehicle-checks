import { jsonResponse } from './lib/response.mjs';

export default async () => jsonResponse({ ok: true, service: 'underwriting-intelligence' });
