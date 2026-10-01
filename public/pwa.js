(() => {
  "use strict";

  const perfLevel = Number(new URLSearchParams(window.location.search).get("perf") || 0);
  if (perfLevel > 0) return;

  let registration = null;
  let waitingWorker = null;
  let reloading = false;
  let deferredInstallPrompt = null;
  const UPDATE_NOTICE_KEY = "guoyun-update-notice-dismissed-version";
  const banner = document.querySelector("#pwaUpdate");
  const installButton = document.querySelector("#installPwaButton");

  function workerVersion(worker) {
    if (!worker) return Promise.resolve(null);
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => resolve(null), 1200);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        resolve(typeof event.data?.version === "string" ? event.data.version : null);
        channel.port1.close();
      };
      worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
    });
  }

  function compareVersions(left, right) {
    const a = String(left || "").split(".").map((part) => Number(part));
    const b = String(right || "").split(".").map((part) => Number(part));
    if (!a.length || !b.length || [...a, ...b].some((part) => !Number.isInteger(part))) return 0;
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const delta = (a[index] || 0) - (b[index] || 0);
      if (delta) return Math.sign(delta);
    }
    return 0;
  }

  async function showUpdate(worker) {
    const candidate = worker || registration?.waiting || null;
    if (!candidate || !navigator.serviceWorker.controller) return;
    const [candidateVersion, activeVersion] = await Promise.all([
      workerVersion(candidate),
      workerVersion(navigator.serviceWorker.controller),
    ]);
    // Older workers that cannot report a version must not trigger a repeated
    // prompt on every page load. New releases must bump APP_VERSION.
    if (!candidateVersion || !activeVersion || compareVersions(candidateVersion, activeVersion) <= 0) return;
    try {
      if (localStorage.getItem(UPDATE_NOTICE_KEY) === candidateVersion) return;
    } catch { /* Showing the prompt is still safe when storage is unavailable. */ }
    waitingWorker = candidate;
    if (banner) banner.hidden = false;
  }

  async function updateNow() {
    if (!waitingWorker) return;
    const ready = await window.TianxiaGame?.prepareForUpdate?.();
    if (ready === false) return;
    reloading = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  function deferUpdate() {
    if (waitingWorker) {
      workerVersion(waitingWorker).then((version) => {
        if (!version) return;
        try { localStorage.setItem(UPDATE_NOTICE_KEY, version); } catch { /* Optional preference. */ }
      });
    }
    if (banner) banner.hidden = true;
  }

  async function install() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (installButton) installButton.hidden = true;
  }

  if (banner) {
    document.querySelector("#pwaUpdateNow")?.addEventListener("click", updateNow);
    document.querySelector("#pwaUpdateLater")?.addEventListener("click", deferUpdate);
  }
  installButton?.addEventListener("click", install);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installButton) installButton.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installButton) installButton.hidden = true;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) window.location.reload();
    });
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
      registration = reg;
      if (reg.waiting) showUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdate(reg.waiting || worker);
        });
      });
    }).catch(() => {
      // A PWA is an enhancement; the online game remains playable without it.
    });
  }

  window.TianxiaPWA = Object.freeze({
    version: window.TIANXIA_VERSION?.APP_VERSION || "0.4.0",
    update: updateNow,
    install,
  });
})();
