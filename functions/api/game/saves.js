import { onRequestGet as readPrimary, onRequestPut as writePrimary } from "../save.js";
import { apiError, json } from "../../_shared/http.js";

// Compatibility collection endpoint for clients that want a save-list shape.
// The current free tier intentionally exposes one primary cloud slot.
export async function onRequestGet(context) {
  const response = await readPrimary(context);
  if (!response.ok) return response;
  const body = await response.json();
  return json({ ok: true, saves: body.save ? [{ id: "primary", ...body.save }] : [] });
}

export async function onRequestPost({ request, env }) {
  // Keep authentication and streaming limits at the shared write boundary.
  return writePrimary({ request, env });
}

export async function onRequestDelete() {
  return apiError(405, "method_not_allowed", "请使用具体存档地址删除。", {
    headers: { allow: "GET, POST" },
  });
}
