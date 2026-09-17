// RTF 的正文编码属于组状态；不能通过删除控制符来提取中文。
export function extractRtfText(buffer: ArrayBuffer): string {
  const input = Array.from(new Uint8Array(buffer), (byte) => String.fromCharCode(byte)).join("");
  const fail = () => new Error("这个 RTF 含有损坏或暂不支持的编码/结构，请另存为 DOCX 或 PDF 后导入。");
  if (!/^\s*\{\\rtf1\b/.test(input)) throw fail();
  type State = { skip: boolean; uc: number; encoding: string; font?: number; fontTable?: boolean };
  let state: State = { skip: false, uc: 1, encoding: "windows-1252" };
  const stack: State[] = [];
  const fonts = new Map<number, string | null>();
  let defaultFont: number | undefined;
  const codepages: Record<number, string> = { 1252: "windows-1252", 936: "gbk", 65001: "utf-8", 950: "big5", 932: "shift_jis", 949: "euc-kr" };
  const charsets: Record<number, string> = { 0: "windows-1252", 128: "shift_jis", 129: "euc-kr", 134: "gbk", 136: "big5", 161: "windows-1253", 162: "windows-1254", 163: "windows-1258", 177: "windows-1255", 178: "windows-1256", 186: "windows-1257", 204: "windows-1251", 222: "windows-874", 238: "windows-1250" };
  let fallback = 0;
  let bytes: number[] = [];
  let output = "";
  const destinations = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "filetbl", "listtable", "listoverridetable", "revtbl", "rsidtbl", "generator", "header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "fldinst", "annotation", "datafield", "themedata", "colorschememapping"]);
  const flush = () => {
    if (!bytes.length) return;
    const fontEncoding = fonts.get(state.font ?? defaultFont ?? -1);
    if (fontEncoding === null && bytes.some((value) => value > 127)) throw fail();
    try { output += new TextDecoder(fontEncoding ?? state.encoding, { fatal: true }).decode(Uint8Array.from(bytes)); }
    catch { throw fail(); }
    bytes = [];
  };
  const emit = (value: string) => {
    flush();
    if (fallback) { fallback--; return; }
    if (!state.skip) output += value;
  };
  const byte = (value: number) => {
    if (fallback) { fallback--; return; }
    if (!state.skip) bytes.push(value);
  };
  for (let i = 0; i < input.length;) {
    const char = input[i++];
    if (char === "{" || char === "}") {
      flush(); fallback = 0;
      if (char === "{") stack.push({ ...state });
      else { if (!stack.length) throw fail(); state = stack.pop()!; }
      continue;
    }
    if (char === "\r" || char === "\n") continue;
    if (char !== "\\") {
      if (!stack.length && !/\s/.test(char)) throw fail();
      if (stack.length) byte(char.charCodeAt(0));
      continue;
    }
    const symbol = input[i++];
    if (symbol === "'") {
      const hex = input.slice(i, i + 2);
      if (!/^[a-f\d]{2}$/i.test(hex)) throw fail();
      byte(parseInt(hex, 16)); i += 2; continue;
    }
    flush();
    if (symbol === "\\" || symbol === "{" || symbol === "}") { emit(symbol); continue; }
    if (symbol === "*") { state.skip = true; continue; }
    if (symbol === "~") { emit("\u00a0"); continue; }
    if (symbol === "_") { emit("-"); continue; }
    if (symbol === "-") continue;
    if (!symbol || !/[a-z]/i.test(symbol)) throw fail();
    const match = input.slice(i - 1).match(/^([a-z]+)(-?\d+)? ?/i)!;
    i = i - 1 + match[0].length;
    const word = match[1];
    const value = match[2] === undefined ? undefined : Number(match[2]);
    if (word === "bin") throw fail(); // 二进制负载不能用文本分词安全跳过。
    if (word === "fonttbl") state.fontTable = true;
    if (state.fontTable && word === "f" && value !== undefined) state.font = value;
    if (state.fontTable && state.font !== undefined && value !== undefined) {
      if (word === "fcharset") fonts.set(state.font, value === 1 ? state.encoding : charsets[value] ?? null);
      if (word === "cpg") fonts.set(state.font, codepages[value] ?? null);
    }
    if (destinations.has(word)) state.skip = true;
    if (state.skip) continue;
    if (["upr", "ud", "mac", "pc", "pca", "cpg", "fcharset"].includes(word)) throw fail();
    if (word === "ansicpg") {
      if (value === undefined || !codepages[value]) throw fail();
      state.encoding = codepages[value];
    } else if (word === "deff") {
      defaultFont = value;
    } else if (word === "f") {
      state.font = value;
    } else if (word === "plain") {
      state.font = defaultFont;
    } else if (word === "uc") {
      if (value === undefined || value < 0 || value > 255) throw fail();
      state.uc = value;
    } else if (word === "u") {
      if (value === undefined || value < -32768 || value > 65535) throw fail();
      output += String.fromCharCode(value < 0 ? value + 65536 : value);
      fallback = state.uc;
    } else {
      const text: Record<string, string> = { par: "\n", line: "\n", tab: "\t", emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”" };
      if (word in text) emit(text[word]);
    }
  }
  flush();
  if (stack.length || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(output)) throw fail();
  return output.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
