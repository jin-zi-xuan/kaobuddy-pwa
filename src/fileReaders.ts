import { extractRtfText } from "./rtf";
import { extractLegacyDocText } from "./legacyDoc";

// pdfjs-dist is ~2.2 MB — only load it when the user actually imports a PDF.
let _pdfLib: typeof import("pdfjs-dist") | null = null;

async function _getPdfLib() {
  if (!_pdfLib) {
    const pdfjsLib = await import("pdfjs-dist");
    const workerMod = await import("pdfjs-dist/build/pdf.worker.mjs?url");
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
    _pdfLib = pdfjsLib;
  }
  return _pdfLib;
}

export function readTextFile(file: File): Promise<string> {
  return file.text();
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export async function readPdfText(file: File): Promise<string> {
  const pdfjsLib = await _getPdfLib();
  const task = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").trim();
        if (text) pages.push(`第 ${pageNumber} 页\n${text}`);
      } finally { page.cleanup(); }
    }
    if (!pages.length) throw new Error("这个 PDF 没有可读取的文字层，请使用「手写 PDF」进行视觉识别，或手动转文字后导入。");
    return pages.join("\n\n");
  } finally { await task.destroy(); }
}

export async function readDocumentText(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".docx")) {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const warnings = result.messages.map((message) => message.message).filter(Boolean);
    const text = result.value.trim();
    if (!text) throw new Error("这个 DOCX 没提取到正文，可以另存为 PDF 后再导入。");
    return [`Word 正文\n${text}`, warnings.length ? `\n读取提醒：${warnings.join("；")}` : ""].filter(Boolean).join("\n");
  }
  if (lower.endsWith(".rtf")) {
    const text = extractRtfText(await file.arrayBuffer());
    if (!text) throw new Error("这个 RTF 没提取到正文，可以另存为 DOCX 或 PDF 后再导入。");
    return `RTF 正文\n${text}`;
  }
  if (lower.endsWith(".doc")) {
    const text = extractLegacyDocText(await file.arrayBuffer());
    return `旧版 Word 正文\n${text}`;
  }
  throw new Error("这个文档格式暂时不能解析，请换成 DOCX、PDF、TXT 或 Markdown。");
}

function decodeXmlText(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, value) => String.fromCodePoint(parseInt(value, 16)));
}

function slideNumberFromPath(path: string) {
  const match = path.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function extractSlideText(xml: string) {
  return Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeXmlText(match[1]).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

export async function readPresentationText(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".ppt")) {
    throw new Error("老版 PPT 暂时不能稳定解析，请另存为 PPTX 或 PDF 后再导入。");
  }
  if (!lower.endsWith(".pptx")) {
    throw new Error("这个演示文稿格式暂时不能解析，请换成 PPTX 或 PDF。");
  }

  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideFiles = zip
    .file(/^ppt\/slides\/slide\d+\.xml$/)
    .sort((a, b) => slideNumberFromPath(a.name) - slideNumberFromPath(b.name));
  if (!slideFiles.length) {
    throw new Error("这个 PPTX 没找到可读取的幻灯片，请另存为 PDF 后再导入。");
  }

  const pages = await Promise.all(
    slideFiles.map(async (slide, index) => {
      const text = extractSlideText(await slide.async("text"));
      return `第 ${index + 1} 页\n${text}`;
    })
  );
  const content = pages.join("\n\n").trim();
  if (!content.replace(/第 \d+ 页/g, "").trim()) {
    throw new Error("这个 PPTX 没提取到正文，可能主要是图片或扫描页，可以另存为 PDF 后导入。");
  }
  return `PPT 正文\n${content}`;
}

export type PdfAiBatch = {
  text: string;
  pageImages: string[];
  pageCount: number;
  startPage: number;
  endPage: number;
};

export type PdfAiOptions = {
  /** 每批最多 6 页；无回调时超过此页数会明确报错。 */
  maxPages?: number;
  onBatch?: (batch: PdfAiBatch) => Promise<void>;
};

export async function readPdfForAi(file: File, options: PdfAiOptions = {}): Promise<{ text: string; pageImages: string[]; pageCount: number }> {
  const maxPages = options.maxPages ?? 6;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 6) throw new Error("PDF 每批识别页数必须在 1 到 6 页之间。");
  const pdfjsLib = await _getPdfLib();
  const task = pdfjsLib.getDocument({ data: await file.arrayBuffer(), stopAtErrors: true });
  try {
    const pdf = await task.promise;
    if (!options.onBatch && pdf.numPages > maxPages) throw new Error(`这个 PDF 超过 ${maxPages} 页，需要分批视觉识别。`);
    const pages: string[] = [];
    let batchText: string[] = [];
    let pageImages: string[] = [];
    let startPage = 1;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const canvas = document.createElement("canvas");
      try {
        const content = await page.getTextContent();
        const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").trim();
        if (text) {
          const labeled = `第 ${pageNumber} 页\n${text}`;
          pages.push(labeled);
          batchText.push(labeled);
        }
        const viewport = page.getViewport({ scale: 1 });
        // 宽、高及像素面积都设限，长卷或超大页面也不会撑爆 canvas。
        const scale = Math.min(1.6, 1400 / viewport.width, 2000 / viewport.height, Math.sqrt(2_000_000 / (viewport.width * viewport.height)));
        if (!Number.isFinite(scale) || scale <= 0) throw new Error(`PDF 第 ${pageNumber} 页尺寸异常，请重新导出后再试。`);
        const renderViewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器无法渲染 PDF 页面，请换一个浏览器后重试。");
        await page.render({ canvasContext: context, viewport: renderViewport }).promise;
        pageImages.push(canvas.toDataURL("image/jpeg", 0.8));
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
      if (options.onBatch && (pageImages.length === maxPages || pageNumber === pdf.numPages)) {
        await options.onBatch({ text: batchText.join("\n\n"), pageImages, pageCount: pdf.numPages, startPage, endPage: pageNumber });
        pageImages = [];
        batchText = [];
        startPage = pageNumber + 1;
      }
    }
    return { text: pages.join("\n\n"), pageImages, pageCount: pdf.numPages };
  } finally { await task.destroy(); }
}
