import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { readPresentationText } from "../../src/fileReaders.ts";

test("readPresentationText extracts text from pptx slides in page order", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types></Types>");
  zip.file("ppt/slides/slide2.xml", "<p:sld><a:t>第二页标题</a:t><a:t>第二页内容</a:t></p:sld>");
  zip.file("ppt/slides/slide1.xml", "<p:sld><a:t>第一页标题</a:t><a:t>第一页内容</a:t></p:sld>");
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const file = new File([buffer], "课件.pptx");

  const text = await readPresentationText(file);

  assert.match(text, /^PPT 正文/);
  assert.ok(text.indexOf("第 1 页") < text.indexOf("第 2 页"));
  assert.ok(text.includes("第一页标题 第一页内容"));
  assert.ok(text.includes("第二页标题 第二页内容"));
});
