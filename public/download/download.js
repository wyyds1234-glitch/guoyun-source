const releaseCards = [...document.querySelectorAll("[data-release-card]")];
const releaseNotice = document.querySelector("#releaseNotice");

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function markUnavailable(card, message = "开发中") {
  if (!card) return;
  card.classList.add("soon");
  const button = card.querySelector("[data-release-button]");
  if (!button) return;
  button.replaceWith(Object.assign(document.createElement("button"), {
    className: "button button-secondary",
    type: "button",
    disabled: true,
    textContent: message,
  }));
}

function markAvailable(card, release) {
  if (!card || !release?.url || release.available !== true) return markUnavailable(card);
  card.classList.remove("soon");
  const button = card.querySelector("[data-release-button]");
  if (!button) return;
  const link = document.createElement("button");
  link.type = "button";
  link.className = button.className;
  const label = release.downloadLabel || `下载 ${release.type || release.label || "安装包"}`;
  link.textContent = label;
  link.addEventListener("click", async () => {
    if (link.disabled) return;
    link.disabled = true;
    link.textContent = "正在下载并校验…";
    try {
      const blob = await verifiedInstallerBlob(release);
      // Download exactly the verified bytes, never fetch the URL a second time.
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = release.asset;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      releaseNotice.textContent = "安装包校验通过，下载已开始。";
    } catch {
      releaseNotice.textContent = "安装包下载或校验失败，请稍后重试。";
    } finally {
      link.disabled = false;
      link.textContent = label;
    }
  });
  button.replaceWith(link);
  const meta = card.querySelector("[data-release-meta]");
  const details = [release.version && `v${release.version}`, release.architecture, release.type, formatBytes(release.size)].filter(Boolean);
  if (meta && details.length) meta.textContent = details.join(" · ");
}

async function probeInstaller(url, expectedSize) {
  const valid = response => response.ok && !/text\/html|application\/json/i.test(response.headers.get('content-type') || '');
  let response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!valid(response)) throw new Error('Installer missing');
  let size = Number(response.headers.get('content-length'));
  // Pages can omit Content-Length on HEAD while serving the real binary.
  // Ask for one byte; if Range is ignored, read only headers and cancel the
  // stream instead of downloading every installer just to enable a button.
  if (size <= 0) {
    response = await fetch(url, { headers: { range: 'bytes=0-0' }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    try {
      if (!valid(response)) throw new Error('Installer missing');
      size = Number(response.headers.get('content-range')?.split('/').pop()) || Number(response.headers.get('content-length'));
    } finally { await response.body?.cancel(); }
  }
  if (size <= 0 || (expectedSize && size !== expectedSize)) throw new Error('Installer size mismatch');
  return size;
}

const MAX_INSTALLER_BYTES = 25 * 1024 * 1024;
function installerUrl(release) {
  const url = new URL(release.url, location.origin);
  if (url.origin !== location.origin || !/^\/downloads\/[\w.-]+\.(dmg|exe)$/.test(url.pathname)
      || !Number.isSafeInteger(release.size) || release.size <= 0 || release.size > MAX_INSTALLER_BYTES
      || !/^[a-f0-9]{64}$/.test(release.sha256 || "")) throw new Error("Invalid installer metadata");
  return url;
}

async function verifiedInstallerBlob(release) {
  const response = await fetch(installerUrl(release), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body || /text\/html|application\/json/i.test(response.headers.get("content-type") || "")) throw new Error("Installer missing");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > release.size) throw new Error("Installer exceeds expected size");
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  if (size !== release.size) throw new Error("Installer size mismatch");
  const blob = new Blob(chunks, { type: "application/octet-stream" });
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  if (hash !== release.sha256) throw new Error("Installer checksum mismatch");
  return blob;
}

async function loadReleaseManifest() {
  try {
    const response = await fetch(`/downloads/latest.json?client=${Date.now()}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    const releases = {
      mac_arm64: { available: manifest.platforms?.mac_arm64?.available === true && Boolean(manifest.mac_arm64_url), url: manifest.mac_arm64_url, asset: manifest.mac_arm64_url?.split('/').pop(), type: "DMG", architecture: "arm64", sha256: manifest.platforms?.mac_arm64?.sha256, size: manifest.mac_size, version: manifest.platforms?.mac_arm64?.version || manifest.version, downloadLabel: "下载 macOS Apple Silicon" },
      windows_x64: { available: manifest.platforms?.windows_x64?.available === true && Boolean(manifest.windows_x64_url), url: manifest.windows_x64_url, asset: manifest.windows_x64_url?.split('/').pop(), type: "EXE", architecture: "x64", sha256: manifest.platforms?.windows_x64?.sha256, size: manifest.windows_size, version: manifest.platforms?.windows_x64?.version || manifest.version, downloadLabel: "下载 Windows" },
    };
    await Promise.all(Object.values(releases).map(async release => {
      if (!release.available) return;
      try {
        const url = installerUrl(release);
        release.size = await probeInstaller(url, release.size);
      } catch { release.available = false; }
    }));
    for (const card of releaseCards) markAvailable(card, releases[card.dataset.releaseCard]);
    const available = Object.values(releases).filter((release) => release.available).length;
    releaseNotice.textContent = available ? `当前版本 ${manifest.version || "未标注"} · 可下载 ${available} 个安装包${manifest.published_at ? ` · 发布于 ${new Date(manifest.published_at).toLocaleDateString("zh-CN")}` : ""}` : "桌面安装包正在准备中，当前可直接游玩网页版。";
  } catch (error) {
    for (const card of releaseCards) markUnavailable(card, "暂不可用");
    releaseNotice.textContent = "暂时无法读取公开版本清单；为避免 404，下载按钮已禁用。";
    console.warn("release manifest unavailable", error);
  }
}

loadReleaseManifest();
