export const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [name, value] of Object.entries(JSON_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return Response.json(data, { ...init, headers });
}

export function apiError(status, code, message, init = {}) {
  return json({ ok: false, error: { code, message } }, { ...init, status });
}

export function methodNotAllowed(allowed) {
  return apiError(405, "method_not_allowed", "不支持此请求方式。", {
    headers: { allow: allowed.join(", ") },
  });
}
