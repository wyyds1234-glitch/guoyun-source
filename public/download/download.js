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
  const link = document.createElement("a");
  link.className = button.className;
  link.href = release.url;
  link.download = release.asset || "";
  link.textContent = release.downloadLabel || `下载 ${release.type || release.label || "安装包"}`;
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

async function loadReleaseManifest() {
  try {
    const response = await fetch(`/downloads/latest.json?client=${Date.now()}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    const releases = {
      mac_arm64: { available: manifest.platforms?.mac_arm64?.available === true && Boolean(manifest.mac_arm64_url), url: manifest.mac_arm64_url, asset: manifest.mac_arm64_url?.split('/').pop(), type: "DMG", architecture: "arm64", size: manifest.mac_size, version: manifest.platforms?.mac_arm64?.version || manifest.version, downloadLabel: "下载 macOS Apple Silicon" },
      windows_x64: { available: manifest.platforms?.windows_x64?.available === true && Boolean(manifest.windows_x64_url), url: manifest.windows_x64_url, asset: manifest.windows_x64_url?.split('/').pop(), type: "EXE", architecture: "x64", size: manifest.windows_size, version: manifest.platforms?.windows_x64?.version || manifest.version, downloadLabel: "下载 Windows" },
    };
    await Promise.all(Object.values(releases).map(async release => {
      if (!release.available) return;
      try {
        const url = new URL(release.url, location.origin);
        if (url.origin !== location.origin || !/^\/downloads\/.+\.(dmg|exe)$/.test(url.pathname)) throw new Error('Unexpected installer URL');
        release.size = await probeInstaller(url, release.size);
      } catch { release.available = false; }
    }));
    for (const card of releaseCards) markAvailable(card, releases[card.dataset.releaseCard]);
    const available = Object.values(releases).filter((release) => release.available).length;
    releaseNotice.textContent = available ? `当前版本 ${manifest.version || "未标注"} · 已验证 ${available} 个安装包${manifest.published_at ? ` · 发布于 ${new Date(manifest.published_at).toLocaleDateString("zh-CN")}` : ""}` : "桌面安装包正在准备中，当前可直接游玩网页版。";
  } catch (error) {
    for (const card of releaseCards) markUnavailable(card, "暂不可用");
    releaseNotice.textContent = "暂时无法读取公开版本清单；为避免 404，下载按钮已禁用。";
    console.warn("release manifest unavailable", error);
  }
}

loadReleaseManifest();
