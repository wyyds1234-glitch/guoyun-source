import { onRequestPut as writePrimary } from "../save.js";

// New-game creation uses the same validated server-side envelope as a save.
// The client still supplies only gameplay state; D1 remains authoritative.
export async function onRequestPost({ request, env }) {
  // The primary writer authenticates and bounds the original request stream.
  return writePrimary({ request, env });
}
