const ACCESS_CODE_PATTERN = /^TX-[A-Z2-9]{8}(?:-[A-Z2-9]{8}){3}$/;

function bytesToBase32(bytes) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

export function normalizeAccessCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (!compact.startsWith("TX") || compact.length !== 34) return null;
  const body = compact.slice(2);
  const normalized = `TX-${body.match(/.{1,8}/g).join("-")}`;
  return ACCESS_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function createAccessCode() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const body = bytesToBase32(bytes).slice(0, 32);
  return `TX-${body.match(/.{1,8}/g).join("-")}`;
}

export function readBearerAccessCode(request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  return normalizeAccessCode(authorization.slice(7));
}

export async function hashAccessCode(accessCode) {
  const bytes = new TextEncoder().encode(accessCode);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
