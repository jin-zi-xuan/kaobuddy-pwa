/** 更新只在用户点击后切换，避免安装新版本时刷新正在编辑的内容。 */
export async function registerServiceWorker(
  serviceWorker: ServiceWorkerContainer = navigator.serviceWorker,
  document: Document = window.document,
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  try {
    const hadController = Boolean(serviceWorker.controller);
    const registration = await serviceWorker.register("/sw.js");
    let requestedUpdate = false;
    let notice: HTMLElement | undefined;
    const showUpdate = () => {
      if (notice) return;
      notice = document.createElement("div");
      notice.setAttribute("role", "status");
      notice.style.cssText = "position:fixed;bottom:max(20px,env(safe-area-inset-bottom));left:16px;right:16px;margin:auto;max-width:460px;z-index:10000;padding:16px;background:#172b26;color:#fff;border-radius:12px;box-shadow:0 4px 24px #0003;font:14px/1.5 system-ui;";
      const message = document.createElement("span");
      message.textContent = "新版本已准备好。请先保存当前编辑，再点击更新。";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "刷新并更新";
      button.style.cssText = "display:block;min-height:44px;margin-top:10px;padding:8px 16px;border:0;border-radius:8px;background:#fff;color:#172b26;cursor:pointer;font:inherit;";
      button.addEventListener("click", () => {
        if (requestedUpdate) return;
        requestedUpdate = true;
        if (registration.waiting) {
          button.textContent = "正在更新…";
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        } else {
          // 另一个标签页可能已经激活了更新，仍由本页用户决定何时刷新。
          reload();
        }
      });
      notice.append(message, button);
      document.body.append(notice);
    };
    serviceWorker.addEventListener("controllerchange", () => {
      if (requestedUpdate) reload();
      else if (hadController) showUpdate();
    });
    if (registration.waiting) showUpdate();
    const watchInstalling = () => {
      const installing = registration.installing;
      if (!installing) return;
      const check = () => {
        if (installing.state === "installed" && serviceWorker.controller) showUpdate();
      };
      installing.addEventListener("statechange", check);
      check();
    };
    registration.addEventListener("updatefound", watchInstalling);
    watchInstalling();
  } catch {
    // 首次离线、浏览器禁用 SW 等情况下，页面本身仍能继续使用。
  }
}
