const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export const RELEASE_PLATFORMS = Object.freeze({
  mac_arm64: Object.freeze({
    label: "macOS Apple Silicon",
    platform: "macOS",
    architecture: "arm64",
    extension: "dmg",
    filePattern: (version) => `Guoyun-${version}-arm64.dmg`,
    r2Prefix: "downloads/mac",
    type: "DMG",
  }),
  windows_x64: Object.freeze({
    label: "Windows",
    platform: "Windows",
    architecture: "x64",
    extension: "exe",
    filePattern: (version) => `Guoyun-Setup-${version}.exe`,
    r2Prefix: "downloads/windows",
    type: "EXE",
  }),
});

function createDefaultReleaseManifest() {
  return {
    version: null,
    mac_arm64_url: null,
    windows_x64_url: null,
    mac_size: null,
    windows_size: null,
    published_at: null,
    platforms: {
      mac_arm64: { ...RELEASE_PLATFORMS.mac_arm64, available: false, status: "development", url: null, size: null },
      windows_x64: { ...RELEASE_PLATFORMS.windows_x64, available: false, status: "development", url: null, size: null },
    },
  };
}

export const DEFAULT_RELEASE_MANIFEST = Object.freeze(createDefaultReleaseManifest());

export function normalizeVersion(value) {
  const version = String(value || "").replace(/^v/, "");
  return VERSION_PATTERN.test(version) ? version : null;
}

export function r2AssetKey(platformId, version) {
  const platform = RELEASE_PLATFORMS[platformId];
  const normalized = normalizeVersion(version);
  if (!platform || !normalized) return null;
  return `${platform.r2Prefix}/${platform.filePattern(normalized)}`;
}

export function releaseManifestFrom(source) {
  const manifest = createDefaultReleaseManifest();
  const version = normalizeVersion(source?.version);
  if (!version) return manifest;
  manifest.version = version;
  manifest.published_at = typeof source.published_at === "string" ? source.published_at : null;
  for (const [id, platform] of Object.entries(RELEASE_PLATFORMS)) {
    const candidate = source?.platforms?.[id];
    const key = r2AssetKey(id, version);
    if (!key || (candidate?.asset && candidate.asset !== key)) continue;
    const sizeKey = id === "mac_arm64" ? "mac_size" : "windows_size";
    const size = Number.isFinite(Number(candidate?.size)) ? Number(candidate.size) : Number(source?.[sizeKey]);
    manifest.platforms[id] = {
      ...platform,
      asset: key,
      available: candidate?.available === true,
      status: candidate?.available === true ? "available" : "development",
      url: null,
      size: Number.isFinite(size) && size > 0 ? size : null,
    };
    manifest[sizeKey] = manifest.platforms[id].size;
  }
  return manifest;
}

export async function readReleaseManifest(bucket) {
  if (!bucket) return createDefaultReleaseManifest();
  try {
    const object = await bucket.get("downloads/latest.json");
    if (!object) return createDefaultReleaseManifest();
    const manifest = releaseManifestFrom(JSON.parse(await object.text()));
    for (const [id, platform] of Object.entries(RELEASE_PLATFORMS)) {
      const release = manifest.platforms[id];
      const key = r2AssetKey(id, manifest.version);
      if (!key || release.available !== true) continue;
      const head = await bucket.head(key);
      if (!head) {
        release.available = false;
        release.status = "development";
        release.size = null;
        if (id === "mac_arm64") manifest.mac_size = null;
        if (id === "windows_x64") manifest.windows_size = null;
        continue;
      }
      release.asset = key;
      release.url = `/api/desktop-download?platform=${encodeURIComponent(id)}`;
      release.size = head.size || release.size;
      if (id === "mac_arm64") {
        manifest.mac_arm64_url = release.url;
        manifest.mac_size = release.size;
      } else {
        manifest.windows_x64_url = release.url;
        manifest.windows_size = release.size;
      }
    }
    return manifest;
  } catch (error) {
    console.error(JSON.stringify({ message: "release manifest read failed", error: error instanceof Error ? error.message : String(error) }));
    return createDefaultReleaseManifest();
  }
}
