import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";

function offlineShell(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "kaobuddy-offline-shell",
    apply: "build",
    enforce: "post",
    configResolved(resolved) { config = resolved; },
    generateBundle(_options, bundle) {
      const template = readFileSync(resolve(config.publicDir, "sw.js"), "utf8");
      const files = Object.keys(bundle).sort();
      // 包括入口、静态 import、分包和 CSS，首次安装就能离线启动。
      const shell = ["/", "/manifest.webmanifest", "/icons/icon.svg", ...files.map((file) => `/${file}`)];
      const hash = createHash("sha256").update(template);
      for (const file of files) {
        const output = bundle[file];
        hash.update(file).update(output.type === "chunk" ? output.code : output.source);
      }
      for (const file of ["manifest.webmanifest", "icons/icon.svg"]) hash.update(readFileSync(resolve(config.publicDir, file)));
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template.replaceAll("__BUILD_TS__", hash.digest("hex").slice(0, 16)).replace("__PRECACHE_MANIFEST__", JSON.stringify(shell)),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  build: {
    outDir: "backend/static",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000"
    }
  }
});
