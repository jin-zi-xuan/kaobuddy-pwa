import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, writeFile, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import vm from "node:vm";
import { build } from "vite";
import config from "../../vite.config.ts";

async function worker(source?: string) {
  const handlers = new Map<string, Function>();
  const stores = new Map<string, Map<string, Response>>();
  let offline = false;
  let status = 200;
  let skipped = 0;
  let windowCount = 0;
  const key = (request: any) => typeof request === "string" ? request : new URL(request.url).pathname;
  const fetcher = async (request: any) => {
    if (offline) throw new Error("offline");
    return new Response(`network:${key(request)}`, { status, headers: { "Content-Type": "text/html" } });
  };
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name)!;
      return {
        addAll: async (urls: string[]) => { for (const url of urls) entries.set(url, await fetcher(url)); },
        put: async (request: any, response: Response) => { entries.set(key(request), response); },
        match: async (request: any) => entries.get(key(request))?.clone(),
      };
    },
    match: async (request: any) => {
      for (const entries of stores.values()) if (entries.has(key(request))) return entries.get(key(request))!.clone();
    },
  };
  vm.runInNewContext(source ?? (await readFile("public/sw.js", "utf8")).replaceAll("__BUILD_TS__", "test").replace("__PRECACHE_MANIFEST__", JSON.stringify(["/", "/assets/entry.js", "/assets/shared.js", "/assets/app.css"])), {
    self: { location: { origin: "https://kaobuddy.test" }, addEventListener: (name: string, fn: Function) => handlers.set(name, fn), skipWaiting: () => { skipped++; }, clients: { claim: async () => {}, matchAll: async () => Array.from({ length: windowCount }, (_, index) => ({ id: String(index) })) } },
    caches, fetch: fetcher, URL, Response,
  });
  return {
    stores, windows(count: number) { windowCount = count; }, get skipped() { return skipped; }, offline() { offline = true; }, status(value: number) { status = value; },
    async dispatch(name: string, fields = {}) {
      const pending: Promise<any>[] = [];
      let response: Promise<Response> | undefined;
      handlers.get(name)?.({ ...fields, waitUntil: (p: Promise<any>) => pending.push(p), respondWith: (p: Promise<Response>) => { response = p; } });
      await Promise.all(pending);
      return response ? await response : undefined;
    },
  };
}
const request = (path: string, mode = "navigate") => ({ url: new URL(path, "https://kaobuddy.test").href, method: "GET", mode });

test("activation preserves installed shell and unrelated app caches; first install works offline", async () => {
  const sw = await worker();
  sw.stores.set("kaobuddy-old", new Map());
  sw.stores.set("other-app", new Map());
  await sw.dispatch("install");
  assert.equal(sw.skipped, 0, "updates must wait for user approval");
  await sw.dispatch("activate");
  assert.equal(sw.stores.has("kaobuddy-old"), false);
  assert.equal(sw.stores.has("other-app"), true);
  sw.offline();
  assert.equal(await (await sw.dispatch("fetch", { request: request("/study") }))?.text(), "network:/");
  for (const asset of ["/assets/entry.js", "/assets/shared.js", "/assets/app.css"]) {
    assert.equal((await sw.dispatch("fetch", { request: request(asset, "cors") }))?.status, 200);
  }
});

test("404 navigation cannot poison shell and API/third-party traffic is not intercepted", async () => {
  const sw = await worker();
  await sw.dispatch("install");
  sw.status(404);
  await sw.dispatch("fetch", { request: request("/missing") });
  for (const path of ["/api/plan", "https://elsewhere.test/file.js", "/health"]) {
    assert.equal(await sw.dispatch("fetch", { request: request(path, "cors") }), undefined);
  }
  sw.offline();
  assert.equal((await sw.dispatch("fetch", { request: request("/") }))?.status, 200);
});

test("build writes versioned complete precache to custom outDir", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kaobuddy-sw-")));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "index.html"), '<script type="module" src="/src/main.js"></script>');
    await writeFile(join(root, "src/main.js"), 'import { value } from "./shared.js"; import "./app.css"; console.log(value);');
    await writeFile(join(root, "src/shared.js"), 'export const value = "one";');
    await writeFile(join(root, "src/app.css"), 'body { color: red; }');
    const run = () => build({ ...config, configFile: false, root, publicDir: resolve("public"), logLevel: "silent", build: { outDir: "custom-dist", rollupOptions: { output: { manualChunks: { shared: [join(root, "src/shared.js")] } } } } });
    await run();
    const first = await readFile(join(root, "custom-dist/sw.js"), "utf8");
    assert.doesNotMatch(first, /__BUILD_TS__|__PRECACHE_MANIFEST__/);
    const sw = await worker(first);
    await sw.dispatch("install");
    const urls = [...[...sw.stores.values()][0].keys()];
    assert.ok(urls.some(url => /index-.*\.js$/.test(url)), "entry must be precached");
    assert.ok(urls.some(url => /shared-.*\.js$/.test(url)), "static imports must be precached");
    assert.ok(urls.some(url => /\.css$/.test(url)), "styles must be precached");
    await run();
    assert.equal(await readFile(join(root, "custom-dist/sw.js"), "utf8"), first, "unchanged builds keep a stable version");
    await writeFile(join(root, "src/shared.js"), 'export const value = "two";');
    await run();
    const second = await readFile(join(root, "custom-dist/sw.js"), "utf8");
    assert.notEqual(first.match(/kaobuddy-[\w-]+/)?.[0], second.match(/kaobuddy-[\w-]+/)?.[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("waiting update only activates and reloads after explicit user action", async () => {
  assert.ok(await readFile("src/serviceWorker.ts", "utf8").catch(() => ""), "safe registration helper must exist");
  const { registerServiceWorker } = await import("../../src/serviceWorker.ts");
  const nodes: any[] = [];
  const document = {
    createElement(tag: string) {
      return { tag, style: { cssText: "" }, textContent: "", children: [] as any[], setAttribute() {}, append(...children: any[]) { this.children.push(...children); }, addEventListener(_name: string, handler: Function) { this.click = handler; }, remove() {}, click: () => {} };
    },
    body: { append(node: any) { nodes.push(node); } },
  };
  let reloads = 0;
  const messages: any[] = [];
  const serviceWorker = new EventTarget() as any;
  serviceWorker.controller = {};
  const registration = Object.assign(new EventTarget(), { waiting: { postMessage: (message: any) => messages.push(message) }, installing: null });
  serviceWorker.register = async () => registration;
  await registerServiceWorker(serviceWorker, document as any, () => { reloads++; });
  assert.equal(nodes.length, 1, "already-waiting updates need a visible prompt");
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads, 0, "another tab activating must not reload this editor");
  assert.equal(messages.length, 0);
  const button = nodes[0].children.find((node: any) => node.tag === "button");
  assert.ok(button);
  button.click();
  assert.equal(messages[0]?.type, "SKIP_WAITING");
  assert.equal(reloads, 0, "wait until the updated worker controls this page");
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads, 1);
});


test("activating an update keeps lazy chunks for older open tabs without reading another app's cache", async () => {
  const sw = await worker();
  sw.windows(2);
  sw.stores.set("other-app", new Map([["/assets/old-lazy-abc123.js", new Response("wrong app")], ["/assets/foreign-def456.js", new Response("foreign")]]));
  sw.stores.set("kaobuddy-older", new Map([["/assets/old-lazy-abc123.js", new Response("older tab chunk")]]));
  sw.stores.set("kaobuddy-previous", new Map([["/assets/previous-lazy-xyz789.js", new Response("previous tab chunk")]]));
  await sw.dispatch("install");
  await sw.dispatch("activate");
  assert.equal(sw.stores.has("kaobuddy-older"), true);
  assert.equal(sw.stores.has("kaobuddy-previous"), true);
  sw.offline();
  assert.equal(await (await sw.dispatch("fetch", { request: request("/assets/old-lazy-abc123.js", "cors") }))?.text(), "older tab chunk");
  assert.equal(await (await sw.dispatch("fetch", { request: request("/assets/previous-lazy-xyz789.js", "cors") }))?.text(), "previous tab chunk");
  assert.equal((await sw.dispatch("fetch", { request: request("/assets/foreign-def456.js", "cors") }))?.status, 503);
});
