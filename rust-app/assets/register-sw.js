const isLocalDevelopment = ["localhost", "127.0.0.1"].includes(window.location.hostname);

if ("serviceWorker" in navigator && !isLocalDevelopment) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
