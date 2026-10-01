(() => {
  "use strict";

  // Tauri exposes this small bridge because the desktop bundle is plain,
  // pre-built HTML.  The web build has no __TAURI__ object and does nothing.
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) return;

  const style = document.createElement("style");
  style.textContent = ".desktop-update-banner{position:fixed;right:24px;top:24px;z-index:10000;display:grid;gap:10px;min-width:280px;padding:16px 18px;border:1px solid rgba(215,178,104,.58);border-radius:8px;background:rgba(25,22,18,.96);color:#f2dfb0;box-shadow:0 12px 34px rgba(0,0,0,.35);font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}.desktop-update-banner[hidden]{display:none}.desktop-update-banner strong{font-size:16px}.desktop-update-banner span{color:#c9b58b}.desktop-update-banner div{display:flex;justify-content:flex-end;gap:8px}.desktop-update-banner button{padding:7px 11px;border:1px solid rgba(215,178,104,.5);border-radius:5px;background:#30271e;color:#f2dfb0;cursor:pointer}.desktop-update-banner .desktop-update-now{background:#8f3b31;color:#fff4dc}.desktop-update-banner button:disabled{opacity:.58;cursor:wait}";
  document.head.appendChild(style);

  const banner = document.createElement("aside");
  banner.className = "desktop-update-banner";
  banner.setAttribute("aria-live", "polite");
  banner.innerHTML = '<strong>新版本可用</strong><span class="desktop-update-version"></span><div><button type="button" class="desktop-update-later">稍后</button><button type="button" class="desktop-update-now">更新并重启</button></div>';
  document.body.appendChild(banner);

  const show = (version) => {
    banner.querySelector(".desktop-update-version").textContent = version ? ` · ${version}` : "";
    banner.hidden = false;
  };
  banner.hidden = true;
  banner.querySelector(".desktop-update-later").addEventListener("click", () => { banner.hidden = true; });
  banner.querySelector(".desktop-update-now").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "正在同步云端…";
    try {
      if (typeof window.TianxiaGame?.prepareForUpdate !== "function") throw new Error("游戏尚未就绪");
      const ready = await window.TianxiaGame.prepareForUpdate();
      if (ready === false) return;
      button.textContent = "正在下载更新…";
      await tauri.core.invoke("install_update");
    } catch (error) {
      window.dispatchEvent(new CustomEvent("tianxia-toast", { detail: { message: `更新失败：${error?.toString?.() || "请稍后重试"}`, tone: "bad" } }));
    } finally {
      button.disabled = false;
      button.textContent = "更新并重启";
    }
  });

  window.setTimeout(async () => {
    try {
      const version = await tauri.core.invoke("check_for_update");
      if (version) show(version);
    } catch {
      // A first install or an unsigned development build simply has no updater.
    }
  }, 1800);
})();
