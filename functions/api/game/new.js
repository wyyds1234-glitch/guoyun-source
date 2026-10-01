import { onRequestPut as writePrimary } from "../save.js";

// New-game creation uses the same validated server-side envelope as a save.
// The client still supplies only gameplay state; D1 remains authoritative.
export async function onRequestPost({ request, env }) {
  const putRequest = new Request(request.url, { method: "PUT", headers: request.headers, body: await request.text() });
  return writePrimary({ request: putRequest, env });
}
