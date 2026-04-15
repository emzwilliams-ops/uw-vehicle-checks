export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}
