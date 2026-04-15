export class ExternalServiceError extends Error {}

async function parseJson(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new ExternalServiceError(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

export async function getJson(url, { headers = {}, timeoutSeconds = 20 } = {}) {
  const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutSeconds * 1000) });
  return parseJson(response);
}

export async function postJson(url, payload, { headers = {}, timeoutSeconds = 20 } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  });
  return parseJson(response);
}

export async function postForm(url, payload, { headers = {}, timeoutSeconds = 20 } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(payload).toString(),
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  });
  return parseJson(response);
}

export async function getText(url, { headers = {}, timeoutSeconds = 20 } = {}) {
  const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutSeconds * 1000) });
  const body = await response.text();
  if (!response.ok) {
    throw new ExternalServiceError(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }
  return { body, contentType: response.headers.get('content-type') || 'text/plain; charset=utf-8' };
}
