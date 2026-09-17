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

import { readDocumentText } from "../../src/fileReaders.ts";

for (const [name, rtf, expected] of [
  ["unicode and signed surrogate", String.raw`{\rtf1\ansi\uc1 \u20013?\u25991?\u-10179?\u-8704?}`, "中文😀"],
  ["scoped unicode fallback", String.raw`{\rtf1\ansi\uc1 \u20013?{\uc2\u25991??}\u23383?}`, "中文字"],
  ["GBK escaped bytes", String.raw`{\rtf1\ansi\ansicpg936 \'d6\'d0\'ce\'c4}`, "中文"],
  ["Windows punctuation", String.raw`{\rtf1\ansi\ansicpg1252 Caf\'e9 \'93oui\'94}`, "Café “oui”"],
  ["destinations and escaped braces", String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}{\*\generator hidden;}hello \{world\}\par next}`, "hello {world}\nnext"],
] as const) {
  test(`RTF preserves ${name}`, async () => {
    assert.equal(await readDocumentText(new File([rtf], "notes.rtf")), `RTF 正文\n${expected}`);
  });
}

for (const rtf of [String.raw`{\rtf1\ansi broken`, String.raw`{\rtf1\ansi\ansicpg99999 \'ff}`, String.raw`{\rtf1\ansi\bin3 abc}`, String.raw`{\rtf1\ansi\ansicpg936 \'d6}`]) {
  test(`RTF rejects damaged or unsupported content ${rtf}`, async () => {
    await assert.rejects(readDocumentText(new File([rtf], "broken.rtf")), /RTF/);
  });
}

test("RTF uses the selected font charset for escaped Chinese bytes", async () => {
  const rtf = String.raw`{\rtf1\ansi\ansicpg1252\deff1{\fonttbl{\f0\fcharset0 Arial;}{\f1\fcharset134 SimSun;}}\f1 \'d6\'d0\'ce\'c4\f0 \'e9}`;
  assert.equal(await readDocumentText(new File([rtf], "mixed.rtf")), "RTF 正文\n中文é");
});
test("RTF preserves raw GBK bytes and skips escaped Unicode fallback", async () => {
  const prefix = new TextEncoder().encode(String.raw`{\rtf1\ansi\ansicpg936 `);
  const suffix = new TextEncoder().encode(String.raw`\uc2\u25991\'ce\'c4}`);
  const data = new Uint8Array([...prefix, 0xd6, 0xd0, ...suffix]);
  assert.equal(await readDocumentText(new File([data], "raw.rtf")), "RTF 正文\n中文");
});
test("RTF refuses unknown selected font encoding instead of corrupting text", async () => {
  const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0\fcharset255 Other;}}\f0 \'d6\'d0}`;
  await assert.rejects(readDocumentText(new File([rtf], "unknown.rtf")), /RTF/);
});
