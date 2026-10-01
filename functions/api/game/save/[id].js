import { onRequestDelete as deletePrimary, onRequestGet as readPrimary } from "../../save.js";
import { apiError } from "../../../_shared/http.js";

function isPrimary(id) {
  return id === "primary";
}

export async function onRequestGet(context) {
  if (!isPrimary(context.params?.id)) return apiError(404, "save_not_found", "该云端存档不存在。");
  return readPrimary(context);
}

export async function onRequestDelete(context) {
  if (!isPrimary(context.params?.id)) return apiError(404, "save_not_found", "该云端存档不存在。");
  return deletePrimary(context);
}
