import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "pdfjs-dist" || specifier.startsWith("pdfjs-dist/build/pdf.worker")) return { url: `mock:${specifier}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "mock:pdfjs-dist") return { format: "module", source: "export const GlobalWorkerOptions = {}; export const getDocument = (options) => { globalThis.__pdfOptions = options; return globalThis.__pdfTask; };", shortCircuit: true };
    if (url.startsWith("mock:")) return { format: "module", source: "export default 'worker';", shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { readPdfText, readPdfForAi } = await import("../../src/fileReaders.ts");

function fixture(texts: string[], dimensions = [600, 800]) {
  const cleaned: number[] = [];
  const rendered: number[] = [];
  const canvases: { width: number; height: number; maxPixels: number }[] = [];
  let destroyed = false;
  const pdf = {
    numPages: texts.length,
    async destroy() { destroyed = true; },
    async getPage(pageNumber: number) {
      return {
        async getTextContent() { return { items: [{ str: texts[pageNumber - 1] }] }; },
        getViewport({ scale }: { scale: number }) { return { width: dimensions[0] * scale, height: dimensions[1] * scale }; },
        render() { rendered.push(pageNumber); return { promise: Promise.resolve() }; },
        cleanup() { cleaned.push(pageNumber); },
      };
    },
  };
  (globalThis as any).__pdfTask = { promise: Promise.resolve(pdf), destroy: pdf.destroy };
  (globalThis as any).document = {
    createElement() {
      const canvas = { width: 0, height: 0, maxPixels: 0, getContext: () => ({}), toDataURL() { this.maxPixels = this.width * this.height; return "data:image/jpeg;base64,page"; } };
      canvases.push(canvas); return canvas;
    },
  };
  return { cleaned, rendered, canvases, destroyed: () => destroyed };
}
const file = () => new File(["mock"], "test.pdf");

test("PDF without a text layer must request visual recognition instead of succeeding with page labels", async () => {
  const state = fixture(["", "   "]);
  await assert.rejects(readPdfText(file()), /视觉识别|手动转文字/);
  assert.equal(state.destroyed(), true);
});
test("PDF text path preserves body and releases pages", async () => {
  const state = fixture(["课本正文", "第二页"]);
  assert.match(await readPdfText(file()), /第 1 页\n课本正文/);
  assert.deepEqual(state.cleaned, [1, 2]);
  assert.equal(state.destroyed(), true);
});
test("PDF visual batches await consumers and release canvases with bounded pixel count", async () => {
  const state = fixture(Array(7).fill(""), [10000, 100000]);
  const batches: number[][] = [];
  const result = await readPdfForAi(file(), { maxPages: 3, async onBatch(batch) {
    batches.push([batch.startPage, batch.endPage, batch.pageImages.length]);
    assert.equal(state.rendered.length, batch.endPage);
    assert.ok(state.canvases.every(c => c.width === 0 && c.height === 0));
    await Promise.resolve();
  } });
  assert.deepEqual(batches, [[1, 3, 3], [4, 6, 3], [7, 7, 1]]);
  assert.deepEqual(result.pageImages, []);
  assert.equal(result.text, "");
  assert.equal(result.pageCount, 7);
  assert.ok(state.canvases.every(c => c.maxPixels <= 2_000_000));
  assert.equal(state.cleaned.length, 7);
  assert.equal(state.destroyed(), true);
});
test("PDF visual reader refuses oversized unbatched requests before rendering", async () => {
  const state = fixture(Array(7).fill(""));
  await assert.rejects(readPdfForAi(file()), /分批/);
  assert.equal(state.rendered.length, 0);
  assert.equal(state.destroyed(), true);
});
test("PDF visual reader destroys document when OCR consumer fails", async () => {
  const state = fixture([""]);
  await assert.rejects(readPdfForAi(file(), { onBatch: async () => { throw new Error("识别失败"); } }), /识别失败/);
  assert.equal(state.destroyed(), true);
});

test("PDF visual parsing requests strict errors and never submits a failed render", async () => {
  const state = fixture([""]);
  const pdf = await (globalThis as any).__pdfTask.promise;
  const originalGetPage = pdf.getPage;
  pdf.getPage = async (pageNumber: number) => {
    const page = await originalGetPage(pageNumber);
    return { ...page, render() { return { promise: Promise.reject(new Error("页面解码失败")) }; } };
  };
  let batches = 0;
  await assert.rejects(readPdfForAi(file(), { onBatch: async () => { batches++; } }), /页面解码失败/);
  assert.equal((globalThis as any).__pdfOptions.stopAtErrors, true);
  assert.equal(batches, 0);
  assert.deepEqual(state.cleaned, [1]);
  assert.ok(state.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.equal(state.destroyed(), true);
});
