import type { CardType, LearnCard, MaterialKind, ParsedMockPaper, ParsedQuestion, StudyMaterial, StudyProject, StudyTask } from "./types";

// ---------------------------------------------------------------------------
// Dates & time helpers
// ---------------------------------------------------------------------------

export function nowIso() {
  return new Date().toISOString();
}

export function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function daysLeft(date: string) {
  if (!date) return "-";
  const target = new Date(`${date}T23:59:59`);
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / 86400000));
}

export function dateLabel(date: string) {
  const today = dateKey();
  const tomorrow = dateKey(new Date(Date.now() + 86400000));
  const yesterday = dateKey(new Date(Date.now() - 86400000));
  if (date === today) return "今天";
  if (date === tomorrow) return "明天";
  if (date === yesterday) return "昨天";
  return new Date(`${date}T00:00:00`).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function normalizeMinutes(value: number) {
  if (!Number.isFinite(value)) return 30;
  return Math.max(10, Math.min(480, Math.round(value)));
}

export function normalizeMockDuration(value: number, fallback = 30) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(5, Math.min(180, Math.round(value)));
}

export function parseRequestedMockDuration(text: string, fallback = 30) {
  const match = text.match(/考试时长\s*[：:]?\s*(\d+)\s*(?:分钟|min)?/i);
  return match ? normalizeMockDuration(Number(match[1]), fallback) : fallback;
}

export type CardSwipeDirection = "next" | "prev" | "stay";

export function decideCardSwipe(offsetX: number, velocityX: number, canGoNext: boolean, canGoPrev: boolean): CardSwipeDirection {
  const projectedX = offsetX + velocityX * 0.12;
  const wantsNext = offsetX < -32 || velocityX < -240 || projectedX < -42;
  const wantsPrev = offsetX > 32 || velocityX > 240 || projectedX > 42;
  if (wantsNext && canGoNext) return "next";
  if (wantsPrev && canGoPrev) return "prev";
  return "stay";
}

export function dateRange(from: string, to: string): string[] {
  const result: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  let current = new Date(start);
  while (current <= end) {
    result.push(dateKey(current));
    current.setDate(current.getDate() + 1);
  }
  return result;
}

export function dayOfWeekLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return labels[d.getDay()] || "";
}

// ---------------------------------------------------------------------------
// Module status helpers
// ---------------------------------------------------------------------------

export type ModuleStatus = "todo" | "doing" | "done";
export type ModulePriority = "low" | "medium" | "high";
export type ModuleDifficulty = "low" | "medium" | "high";

export function moduleStatus(task: StudyTask): ModuleStatus {
  if (task.module_status) return task.module_status;
  return task.status === "done" ? "done" : "todo";
}

export function learningButtonAction(task: StudyTask): "start" | "open" {
  return moduleStatus(task) === "doing" ? "open" : "start";
}

export function taskOrder(task: StudyTask, fallback: number) {
  return typeof task.order === "number" ? task.order : fallback;
}

// ---------------------------------------------------------------------------
// Material helpers
// ---------------------------------------------------------------------------

export function materialKindLabel(material: StudyMaterial) {
  const labels: Record<MaterialKind, string> = {
    pdf: "PDF 课件 · 文字和页面识别",
    document: "Word / DOC 资料",
    markdown: "Markdown 笔记",
    text: "手动文本",
    file: "文本文件",
    handwriting: "手写笔记",
    video: "视频字幕"
  };
  return labels[material.kind] || material.kind;
}

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

export function stripMarkdown(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-—–_]{3,}\s*$/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/[*_~#]+/g, "")
    .trim();
}

export function isDividerLine(text: string) {
  return /^[-—–_]{3,}$/.test(text.trim());
}

export function tableCells(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "").trim();
  return trimmed.includes("|")
    ? trimmed.split("|").map((cell) => cell.trim()).filter(Boolean)
    : trimmed.split(/\s+/).map((cell) => cell.trim()).filter(Boolean);
}

export function isTableSeparator(line: string) {
  const cells = tableCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function parseTableBlock(lines: string[]) {
  const separatorIndex = lines.findIndex(isTableSeparator);
  if (separatorIndex <= 0) return null;
  const headers = tableCells(lines[separatorIndex - 1]);
  if (headers.length < 2) return null;
  const rows = lines
    .slice(separatorIndex + 1)
    .map(tableCells)
    .filter((cells) => cells.length === headers.length);
  return rows.length ? { headers, rows } : null;
}

export function previewText(text: string, max = 220) {
  return stripMarkdown(text).replace(/\n{3,}/g, "\n\n").slice(0, max);
}

export function compactTitle(raw: string, fallback: string) {
  const cleaned = stripMarkdown(raw)
    .replace(/^(模块|知识点|名称|标题)\s*[:：]?\s*/i, "")
    .replace(/优先级\s*[:：]?\s*[高中低]/g, "")
    .replace(/预计(学习)?时间\s*[:：]?\s*\d+(\.\d+)?\s*(分钟|min|小时|h)/gi, "")
    .trim();
  const firstPart = cleaned.split(/[：:。；;，,\n（(]/)[0]?.trim();
  const title = (firstPart || cleaned || fallback).replace(/\s+/g, " ");
  return title.length > 18 ? `${title.slice(0, 18)}...` : title;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

export function getJsonArrayTexts(text: string) {
  const cleaned = stripMarkdown(text);
  const arrays: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "[") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "]" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        arrays.push(cleaned.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return arrays;
}

export function jsonModulesToHumanText(text: string) {
  const jsonTexts = getJsonArrayTexts(text);
  if (!jsonTexts.length) return "";
  try {
    const data = jsonTexts.flatMap((jsonText) => {
      const parsed = JSON.parse(jsonText);
      return Array.isArray(parsed) ? parsed : [];
    });
    if (!data.length) return "";
    const modules = data
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const record = item as Record<string, unknown>;
        const title = String(record.title || record.name || record.module || record.moduleName || "").trim();
        if (!title) return "";
        const minutes = record.estimatedminutes ?? record.estimated_minutes ?? record.estimatedMinutes ?? record.minutes;
        const priority = String(record.priority || "").trim();
        const note = String(record.note || record.reason || record.description || record.practice || "").trim();
        const sourceTitle = String(record.sourceTitle || record.source_title || record.source || record.material || "").trim();
        const evidence = String(record.evidence || record.quote || record.sourceEvidence || record.source_evidence || "").trim();
        return [
          `模块：${title}`,
          minutes ? `预计时间：${minutes} 分钟` : "",
          priority ? `优先级：${priority}` : "",
          sourceTitle ? `资料来源：${sourceTitle}` : "",
          evidence ? `证据：${evidence}` : "",
          note ? `说明：${note}` : ""
        ].filter(Boolean).join("\n");
      })
      .filter(Boolean);
    return modules.join("\n\n");
  } catch {
    return "";
  }
}

export function humanReadableAiText(text: string) {
  return jsonModulesToHumanText(text) || stripMarkdown(text);
}

const READING_SECTION_TITLE_PATTERN = "结论|零基础解释|高频考点|例题|易错点|易错提醒|核心概念|必背要点|常见考法|考试答法|参考答案|解析|常考方式";
const READING_SECTION_TITLES = new RegExp(`^(${READING_SECTION_TITLE_PATTERN})$`);
const INLINE_READING_SECTION = new RegExp(`(?:^|[\\n。！？.!?]\\s*)(${READING_SECTION_TITLE_PATTERN})\\s*[：:]\\s*`, "g");

export function mergeReadingBlocks(blocks: string[]) {
  const merged: string[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const current = blocks[index].trim();
    const next = blocks[index + 1]?.trim();
    if (READING_SECTION_TITLES.test(current) && next && !READING_SECTION_TITLES.test(next)) {
      merged.push(`${current}：${next}`);
      index += 1;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function splitInlineReadingSections(block: string) {
  const matches = Array.from(block.matchAll(INLINE_READING_SECTION));
  if (!matches.length) return [block];

  const sections = matches.map((match) => {
    const fullMatch = match[0];
    const title = match[1];
    const titleOffset = fullMatch.indexOf(title);
    const colonOffset = fullMatch.slice(titleOffset).search(/[：:]/);
    const titleStart = match.index! + titleOffset;
    const bodyStart = titleStart + colonOffset + 1;
    return { title, titleStart, bodyStart };
  });

  const result: string[] = [];
  const leading = block.slice(0, sections[0].titleStart).trim();
  if (leading) result.push(leading);

  sections.forEach((section, index) => {
    const nextTitleStart = sections[index + 1]?.titleStart ?? block.length;
    const body = block.slice(section.bodyStart, nextTitleStart).trim();
    result.push(`${section.title}：${body}`);
  });
  return result.filter(Boolean);
}

export function readingTextBlocks(text: string) {
  const rawBlocks = humanReadableAiText(text)
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split(/\n/)
        .map((line) => line.trim())
        .filter((line) => line && !isDividerLine(line))
        .join("\n")
        .trim()
    )
    .filter(Boolean);

  return mergeReadingBlocks(rawBlocks)
    .flatMap(splitInlineReadingSections)
    .map((block) => block.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Difficulty / Priority helpers
// ---------------------------------------------------------------------------

export function parsePriority(line: string): ModulePriority {
  if (/high/i.test(line)) return "high";
  if (/low/i.test(line)) return "low";
  if (/重要排名\s*[:：]?\s*[1-3]\b|高|重要|核心|优先/.test(line)) return "high";
  if (/低|选学|有空/.test(line)) return "low";
  return "medium";
}

export function parseDifficulty(text: string): ModuleDifficulty {
  const cleaned = stripMarkdown(text);
  const match = cleaned.match(/难度\s*[:：]\s*(低|中|高|简单|一般|困难)/);
  const value = match?.[1] || cleaned;
  if (/high/i.test(value)) return "high";
  if (/low/i.test(value)) return "low";
  if (/高|困难|难/.test(value)) return "high";
  if (/低|简单|易/.test(value)) return "low";
  return "medium";
}

export function difficultyLabel(value?: ModuleDifficulty) {
  if (value === "high") return "难度高";
  if (value === "low") return "难度低";
  return "难度中";
}

export function priorityLabel(value?: ModulePriority) {
  if (value === "high") return "高重要";
  if (value === "low") return "低重要";
  return "中重要";
}

export function moduleImportanceLabel(module: StudyTask, allModules?: StudyTask[]) {
  const modules = allModules?.length ? allModules : [module];
  return priorityLabel(moduleImportanceBucket(module, modules));
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

export function extractNumber(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

export function extractField(text: string, names: string[]) {
  const label = names.join("|");
  const pattern = new RegExp(`(?:${label})\\s*[:：]\\s*([^；;\\n]+)`);
  return stripMarkdown(text.match(pattern)?.[1] || "").trim();
}

export function extractExamPoints(text: string) {
  return extractField(text, ["考察内容", "考查内容", "考点内容", "考试内容", "会考什么", "重点"]);
}

function canonicalModuleTitle(title: string, context = "") {
  const text = stripMarkdown(`${title} ${context}`).replace(/\s+/g, "");
  if (/(P[,，、/]?V|PV|P、V|P，V|P,V)操作/.test(text) && /(独木桥|水果盘|生产者|消费者|同步|互斥|信号量|问题|实现)/.test(text)) {
    return "信号量P、V操作";
  }
  const term = findKnowledgeTerm(text);
  const isScenarioTitle = /例题|习题|真题|题型|应用题|场景题|问题|案例|实现|判断|计算|求解|证明|设计|分析/.test(text);
  if (term && isScenarioTitle && stripMarkdown(title).replace(/\s+/g, "") !== term) {
    return term;
  }
  return title;
}

function mergeModuleText(current: string | undefined, next: string | undefined) {
  const parts = [current, next].map((item) => stripMarkdown(item || "").trim()).filter(Boolean);
  return Array.from(new Set(parts)).join("；");
}

// ---------------------------------------------------------------------------
// Module title extraction
// ---------------------------------------------------------------------------

const knowledgeTerms = [
  "操作系统引论",
  "银行家算法",
  "安全性算法",
  "安全序列",
  "死锁预防",
  "死锁避免",
  "死锁检测",
  "进程同步",
  "进程通信",
  "进程调度",
  "处理器调度",
  "线程",
  "进程",
  "互斥",
  "P、V操作",
  "P,V操作",
  "PV操作",
  "信号量",
  "管程",
  "死锁",
  "内存管理",
  "虚拟存储",
  "页面置换",
  "分页",
  "分段",
  "文件目录",
  "文件管理",
  "磁盘调度",
  "磁盘存储",
  "设备管理",
  "输入输出",
  "I/O"
];

function findKnowledgeTerm(text: string) {
  const cleaned = stripMarkdown(text).replace(/\s+/g, "");
  return [...knowledgeTerms]
    .sort((a, b) => b.length - a.length)
    .find((item) => cleaned.includes(item.replace(/\s+/g, ""))) || "";
}

export function extractModuleTitle(line: string) {
  const cleaned = stripMarkdown(line)
    .replace(/预计(学习)?时间\s*[:：]?\s*\d+(\.\d+)?\s*(分钟|min|小时|h)/gi, "")
    .replace(/预计完成时间\s*[:：]?\s*\d+(\.\d+)?\s*(分钟|min|小时|h)/gi, "")
    .replace(/难度\s*[:：]\s*(低|中|高|简单|一般|困难)/g, "")
    .replace(/重要(程度)?排名\s*[:：]?\s*\d+/g, "")
    .replace(/\d+(\.\d+)?\s*(分钟|min|小时|h)/gi, "")
    .replace(/^(第\s*\d+\s*(天|章|页)\s*)+/g, "")
    .trim();
  const explicit = cleaned.match(/(?:模块名称|知识点名称|模块名|知识点|考点|主题)\s*[:：]\s*([^，。；;\n｜|]+?)(?:\s+预计|$|[，。；;\n｜|])/i);
  const pipeFirst = cleaned.split(/[｜|]/)[0]?.trim();
  const candidate = (explicit?.[1] || pipeFirst || cleaned)
    .replace(/^(模块|知识点|考点)\s*\d*\s*[:：]?\s*/i, "")
    .replace(/^(名称|标题)\s*[:：]?\s*/i, "")
    .replace(/\s+/g, "");
  const term = findKnowledgeTerm(cleaned);
  if (!candidate) return term || "";
  if (candidate.length < 2 || candidate.length > 16) return term || "";
  if (/第\s*\d+\s*(天|章|页)|每天|天数|高频|聚焦|高效|综合|复习|练习|任务|计划|安排|资料|时间|完成|根据|模块$/.test(candidate)) return term || "";
  return canonicalModuleTitle(candidate, cleaned);
}

export function isGenericModuleText(text: string) {
  const cleaned = stripMarkdown(text).replace(/\s+/g, "");
  return /第\d+天|每日任务|天数|全真模拟|模拟测试|模拟卷|模考|错题回顾|串联|综合复习|复习计划|练习安排|学习安排|高效利用时间|聚焦高频|高频考点|补充要求|建议通读|选择题相关模块/.test(cleaned);
}

export function isGenericModuleTitle(title: string) {
  const cleaned = stripMarkdown(title).replace(/\s+/g, "");
  return !cleaned || /^(好的|关于时间|知识点|模块|计划|任务|复习|练习)$/.test(cleaned) || isGenericModuleText(cleaned);
}

export function displayModuleTitle(title: string, note?: string) {
  const cleaned = stripMarkdown(title).replace(/\s+/g, "");
  const extracted = extractModuleTitle(cleaned) || extractModuleTitle(note || "");
  return extracted || compactTitle(cleaned, "知识点");
}

export function isStudyModule(item: StudyTask) {
  const title = displayModuleTitle(item.title, item.note || item.exam_points);
  if (!title || title === "知识点") return false;
  return !isGenericModuleTitle(title) && !isGenericModuleTitle(item.title);
}

export function moduleKey(module: StudyTask) {
  return displayModuleTitle(module.title, module.note).replace(/\s+/g, "");
}

export function textIncludesMaterialPoint(text: string, value?: string) {
  const needle = stripMarkdown(value || "").replace(/\s+/g, "");
  if (!needle || needle.length < 2) return false;
  return stripMarkdown(text).replace(/\s+/g, "").includes(needle);
}

export function moduleOnlyBelongsToMaterial(module: StudyTask, deleted: StudyMaterial, remaining: StudyMaterial[]) {
  const sourceMatchesDeleted =
    module.source_material_id === deleted.id ||
    stripMarkdown(module.source_title || "").trim() === deleted.title.trim();
  if (!sourceMatchesDeleted) return false;
  const title = displayModuleTitle(module.title, module.note);
  return !remaining.some((material) =>
    textIncludesMaterialPoint(material.content, title) ||
    textIncludesMaterialPoint(material.content, module.evidence)
  );
}

// ---------------------------------------------------------------------------
// Project payload
// ---------------------------------------------------------------------------

export function toProjectPayload(project: StudyProject) {
  return {
    subject: project.subject,
    exam_date: project.exam_date,
    daily_minutes: project.daily_minutes,
    target_score: project.target_score,
    weak_points: project.weak_points
  };
}

// ---------------------------------------------------------------------------
// Parse AI plan output → StudyTask[]
// ---------------------------------------------------------------------------

const MAX_TEXT_PLAN_MODULE_LINES = 2000;

export type DailyPlanItem = {
  module_id: string;
  date: string;
  day_order: number;
  reason?: string;
};

export type DailyPlanGroup = {
  date: string;
  items: StudyTask[];
  importanceCounts: Record<ModulePriority, number>;
};

export function dailyPlanDates(project: Pick<StudyProject, "exam_date">, today = dateKey()) {
  const todayDate = new Date(`${today}T00:00:00`);
  const examDate = new Date(`${project.exam_date}T00:00:00`);
  if (Number.isNaN(examDate.getTime()) || examDate < todayDate) return [today];
  return dateRange(today, project.exam_date);
}

export function moduleImportanceBucket(module: StudyTask, sortedModules: StudyTask[]): ModulePriority {
  if (typeof module.importance_rank !== "number") return module.priority || "medium";
  const rank = module.importance_rank;
  const total = Math.max(1, sortedModules.length);
  if (rank <= Math.ceil(total / 3)) return "high";
  if (rank <= Math.ceil((total * 2) / 3)) return "medium";
  return "low";
}

export function buildDailyPlanGroups(
  modules: StudyTask[],
  project: Pick<StudyProject, "exam_date"> | null,
  today = dateKey()
): DailyPlanGroup[] {
  const groups = new Map<string, StudyTask[]>();
  const yesterdayKey = dateKey(new Date(new Date(`${today}T00:00:00`).getTime() - 86400000));
  const visibleDates = project ? [yesterdayKey, ...dailyPlanDates(project, today)] : [yesterdayKey, today];
  visibleDates.forEach((date) => groups.set(date, []));

  modules
    .filter((item) => item.date && moduleStatus(item) !== "done")
    .forEach((item) => {
      if (!item.date) return;
      groups.set(item.date, [...(groups.get(item.date) || []), item]);
    });

  return Array.from(groups.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => taskOrder(a, 0) - taskOrder(b, 0)),
      importanceCounts: items.reduce((counts, item) => {
        const bucket = moduleImportanceBucket(item, modules);
        counts[bucket] += 1;
        return counts;
      }, { high: 0, medium: 0, low: 0 } as Record<ModulePriority, number>)
    }));
}

export function buildBalancedDailyPlan(
  modules: StudyTask[],
  project: Pick<StudyProject, "exam_date" | "daily_minutes">,
  today = dateKey(),
  aiItems: DailyPlanItem[] = []
): DailyPlanItem[] {
  const dates = dailyPlanDates(project, today);
  const moduleMap = new Map(modules.map((module) => [module.id, module]));
  const aiReasonByModule = new Map(
    aiItems
      .filter((item) => moduleMap.has(item.module_id))
      .map((item) => [item.module_id, item.reason || ""])
  );
  const days = dates.map((date) => ({
    date,
    minutes: 0,
    counts: { high: 0, medium: 0, low: 0 } as Record<ModulePriority, number>,
    modules: [] as { module: StudyTask; bucket: ModulePriority }[]
  }));
  const sorted = [...modules].sort((a, b) => {
    const rankA = a.importance_rank ?? 9999;
    const rankB = b.importance_rank ?? 9999;
    return rankA - rankB || taskOrder(a, 0) - taskOrder(b, 0);
  });
  const buckets: Record<ModulePriority, StudyTask[]> = { high: [], medium: [], low: [] };
  sorted.forEach((module) => buckets[moduleImportanceBucket(module, sorted)].push(module));

  (["high", "medium", "low"] as ModulePriority[]).forEach((bucket) => {
    buckets[bucket].forEach((module) => {
      const candidates = days.filter((day) => day.minutes + module.estimated_minutes <= project.daily_minutes);
      const pool = candidates.length ? candidates : days;
      const target = pool
        .slice()
        .sort((a, b) =>
          a.counts[bucket] - b.counts[bucket] ||
          a.minutes - b.minutes ||
          a.date.localeCompare(b.date)
        )[0];
      target.modules.push({ module, bucket });
      target.minutes += module.estimated_minutes;
      target.counts[bucket] += 1;
    });
  });

  return days.flatMap((day) =>
    day.modules
      .sort((a, b) => {
        const weight = { high: 0, medium: 1, low: 2 };
        return weight[a.bucket] - weight[b.bucket] ||
          (a.module.importance_rank ?? 9999) - (b.module.importance_rank ?? 9999) ||
          taskOrder(a.module, 0) - taskOrder(b.module, 0);
      })
      .map(({ module }, index) => ({
        module_id: module.id,
        date: day.date,
        day_order: index + 1,
        reason: aiReasonByModule.get(module.id) || "按考试倒计时和重要性均衡安排。"
      }))
  );
}

function mergeParsedModules(modules: StudyTask[]) {
  const byTitle = new Map<string, StudyTask>();
  modules.forEach((module) => {
    const key = moduleKey(module);
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, module);
      return;
    }
    byTitle.set(key, {
      ...existing,
      estimated_minutes: Math.max(existing.estimated_minutes, module.estimated_minutes),
      difficulty: existing.difficulty === "high" || module.difficulty === "high" ? "high" : existing.difficulty,
      importance_rank: Math.min(existing.importance_rank ?? 9999, module.importance_rank ?? 9999),
      exam_points: mergeModuleText(existing.exam_points, module.exam_points || module.note),
      source_title: mergeModuleText(existing.source_title, module.source_title),
      source_section: mergeModuleText(existing.source_section, module.source_section),
      evidence: mergeModuleText(existing.evidence, module.evidence),
      note: mergeModuleText(existing.note, module.note),
      updated_at: nowIso()
    });
  });
  return Array.from(byTitle.values()).map((module, index) => ({
    ...module,
    order: module.order ?? index,
    importance_rank: module.importance_rank && module.importance_rank < 9999 ? module.importance_rank : index + 1
  }));
}

export function parseModulesFromPlan(content: string, projectId: string, noteId: string, existingCount: number, makeId: () => string): StudyTask[] {
  const jsonTexts = getJsonArrayTexts(content);
  if (jsonTexts.length) {
    try {
      const data = jsonTexts.flatMap((jsonText) => {
        const parsed = JSON.parse(jsonText);
        return Array.isArray(parsed) ? parsed : [];
      });
      const modules = data.flatMap((item, index) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const rawTitle = String(record.title || record.name || record.module || record.moduleName || "");
        const note = String(record.note || record.reason || record.description || record.practice || "");
        const examPoints = String(record.exam_points || record.examPoints || record.exampoints || record.points || record.content || record.test_points || record.testPoints || note || "");
        const sourceMaterialId = String(record.sourceMaterialId || record.source_material_id || record.materialId || record.material_id || "");
        const sourceTitle = String(record.sourceTitle || record.source_title || record.source || record.material || "");
        const sourceSection = String(record.sourceSection || record.source_section || record.section || record.page || "");
        const evidence = String(record.evidence || record.quote || record.sourceEvidence || record.source_evidence || "");
        const title = extractModuleTitle(rawTitle) || extractModuleTitle(note) || extractModuleTitle(examPoints);
        if (!title || isGenericModuleTitle(title) || isGenericModuleTitle(rawTitle)) return [];
        const normalizedRawTitle = stripMarkdown(rawTitle).replace(/\s+/g, "");
        const normalizedTitle = stripMarkdown(title).replace(/\s+/g, "");
        const mergedExamPoints = normalizedRawTitle && normalizedRawTitle !== normalizedTitle
          ? mergeModuleText(examPoints, `例题：${rawTitle}`)
          : examPoints;
        const rawMinutes = Number(record.estimatedminutes ?? record.estimated_minutes ?? record.estimatedMinutes ?? record.minutes);
        const rawRank = Number(record.importance_rank ?? record.importanceRank ?? record.importancerank ?? record.rank);
        const line = humanReadableAiText(JSON.stringify([record]));
        return [{
          id: makeId(),
          project_id: projectId,
          title,
          date: "",
          estimated_minutes: Number.isFinite(rawMinutes) ? normalizeMinutes(rawMinutes) : 45,
          status: "todo",
          module_status: "todo",
          priority: parsePriority(String(record.priority || "")),
          difficulty: parseDifficulty(String(record.difficulty || record.level || "")),
          importance_rank: Number.isFinite(rawRank) ? rawRank : existingCount + index + 1,
          exam_points: stripMarkdown(mergedExamPoints),
          order: existingCount + index,
          source_note_id: noteId,
          source_material_id: stripMarkdown(sourceMaterialId),
          source_title: stripMarkdown(sourceTitle),
          source_section: stripMarkdown(sourceSection),
          evidence: stripMarkdown(evidence),
          note: line || note || rawTitle,
          created_at: nowIso(),
          updated_at: nowIso()
        }] as StudyTask[];
      });
      return mergeParsedModules(modules);
    } catch {
      // Fall back to line parsing below.
    }
  }
  const blockText = stripMarkdown(content);
  const moduleBlocks = blockText
    .split(/(?=模块\s*[:：])/)
    .map((block) => block.trim())
    .filter((block) => /^模块\s*[:：]/.test(block));
  if (moduleBlocks.length) {
    const modules = moduleBlocks.flatMap((block, index) => {
      const title = extractModuleTitle(block);
      if (!title || isGenericModuleTitle(title)) return [];
      const minutesMatch = block.match(/(?:预计(?:完成|学习)?时间|预计时间)\s*[:：]?\s*(\d+)\s*(分钟|min)/i);
      const hourMatch = block.match(/(\d+(?:\.\d+)?)\s*(小时|h)/i);
      const estimatedMinutes = minutesMatch
        ? normalizeMinutes(Number(minutesMatch[1]))
        : hourMatch
          ? normalizeMinutes(Number(hourMatch[1]) * 60)
          : 45;
      const rank = extractNumber(block, [/重要(?:程度)?排名\s*[:：]?\s*(\d+)/, /排名\s*[:：]?\s*(\d+)/]);
      const examPoints = extractField(block, ["说明", "考察内容", "考查内容", "考点内容", "考试内容", "会考什么", "重点"]);
      const sourceTitle = extractField(block, ["资料来源", "来源资料", "来源", "sourceTitle"]);
      const sourceSection = extractField(block, ["资料位置", "来源位置", "章节", "页码", "sourceSection"]);
      const evidence = extractField(block, ["证据", "资料证据", "原文依据", "evidence"]);
      return [{
        id: makeId(),
        project_id: projectId,
        title,
        date: "",
        estimated_minutes: estimatedMinutes,
        status: "todo",
        module_status: "todo",
        priority: parsePriority(block),
        difficulty: parseDifficulty(block),
        importance_rank: rank || existingCount + index + 1,
        exam_points: examPoints,
        order: existingCount + index,
        source_note_id: noteId,
        source_title: sourceTitle,
        source_section: sourceSection,
        evidence,
        note: block,
        created_at: nowIso(),
        updated_at: nowIso()
      }] as StudyTask[];
    });
    return mergeParsedModules(modules);
  }

  const rawLines = content
    .split(/\n+/)
    .map((line) => stripMarkdown(line).replace(/^[\s\-*•\d.、)]+/, "").trim())
    .filter((line) => line.length >= 2);
  const candidateLines = rawLines
    .filter((line) => /模块名称|知识点名称|模块名|知识点|考点|主题|预计|分钟|小时/.test(line))
    .slice(0, MAX_TEXT_PLAN_MODULE_LINES);
  const lines = candidateLines.length ? candidateLines : rawLines.slice(0, MAX_TEXT_PLAN_MODULE_LINES);
  const modules = lines.flatMap((line, index) => {
    const title = extractModuleTitle(line);
    if (!title || isGenericModuleTitle(title) || isGenericModuleText(line)) return [];
    const minutesMatch = line.match(/(?:预计(?:完成|学习)?时间\s*[:：]?\s*)?(\d+)\s*(分钟|min)/i);
    const hourMatch = line.match(/(\d+(?:\.\d+)?)\s*(小时|h)/i);
    const estimatedMinutes = minutesMatch
      ? normalizeMinutes(Number(minutesMatch[1]))
      : hourMatch
        ? normalizeMinutes(Number(hourMatch[1]) * 60)
        : 45;
    const rank = extractNumber(line, [/重要(?:程度)?排名\s*[:：]?\s*(\d+)/, /排名\s*[:：]?\s*(\d+)/]);
    const examPoints = extractExamPoints(line);
    const sourceTitle = extractField(line, ["资料来源", "来源资料", "来源", "sourceTitle"]);
    const sourceSection = extractField(line, ["资料位置", "来源位置", "章节", "页码", "sourceSection"]);
    const evidence = extractField(line, ["证据", "资料证据", "原文依据", "evidence"]);
    return [{
      id: makeId(),
      project_id: projectId,
      title,
      date: "",
      estimated_minutes: estimatedMinutes,
      status: "todo",
      module_status: "todo",
      priority: parsePriority(line),
      difficulty: parseDifficulty(line),
      importance_rank: rank || existingCount + index + 1,
      exam_points: examPoints,
      order: existingCount + index,
      source_note_id: noteId,
      source_title: sourceTitle,
      source_section: sourceSection,
      evidence,
      note: line,
      created_at: nowIso(),
      updated_at: nowIso()
    }] as StudyTask[];
  });
  return mergeParsedModules(modules);
}

export function parseDailyPlan(content: string): DailyPlanItem[] {
  // Try to extract and parse JSON from the raw content
  const tryParse = (text: string): DailyPlanItem[] | null => {
    // Strategy A: find JSON array directly in text (no markdown stripping)
    const arrays = getJsonArrayTexts(text);
    // Strategy B: strip code fences and find JSON
    const noFence = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
    const arraysNoFence = getJsonArrayTexts(noFence);
    const allArrays = [...arrays, ...arraysNoFence];

    for (const jsonText of allArrays) {
      try {
        const data = JSON.parse(jsonText);
        if (!Array.isArray(data)) continue;

        const items: DailyPlanItem[] = [];
        for (const item of data) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;

          // Get value by trying multiple possible keys (with/without underscores due to stripMarkdown)
          const getKeyFrom = (source: Record<string, unknown>, ...keys: string[]): string => {
            for (const k of keys) {
              const v = source[k];
              if (typeof v === "string" && v.trim()) return v.trim();
              if (typeof v === "number") return String(v);
            }
            return "";
          };
          const getKey = (...keys: string[]) => getKeyFrom(record, ...keys);

          // Day-grouped format: {date, modules: [{module_id, ...}], total_minutes}
          if ("modules" in record && Array.isArray(record.modules)) {
            const rawDate = getKey("date");
            const date = normalizeDate(rawDate);
            if (!date || date === "unplanned") continue;
            for (let mi = 0; mi < (record.modules as unknown[]).length; mi++) {
              const m = (record.modules as unknown[])[mi] as Record<string, unknown> | null;
              if (!m || typeof m !== "object") continue;
              const moduleId = getKeyFrom(m, "module_id", "moduleId", "moduleid", "id");
              if (!moduleId) continue;
              const dayOrder = Number(m.day_order ?? m.dayOrder ?? m.dayorder ?? mi + 1);
              items.push({
                module_id: moduleId, date,
                day_order: Number.isFinite(dayOrder) && dayOrder > 0 ? dayOrder : mi + 1,
                reason: stripMarkdown(String(m.reason || ""))
              });
            }
            continue;
          }

          // Flat format: {module_id, date, day_order, reason}
          const moduleId = getKey("module_id", "moduleId", "moduleid", "id");
          const rawDate = getKey("date");
          const date = normalizeDate(rawDate);
          if (!moduleId || !date) continue;
          const dayOrder = Number(record.day_order ?? record.dayOrder ?? record.dayorder ?? record.order ?? 0);
          items.push({
            module_id: moduleId, date,
            day_order: Number.isFinite(dayOrder) && dayOrder > 0 ? dayOrder : 1,
            reason: stripMarkdown(String(record.reason || ""))
          });
        }
        if (items.length) return items;
      } catch {
        // Try next array
      }
    }
    return null;
  };

  return tryParse(content) || [];
}

function normalizeDate(raw: string): string {
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const slashMatch = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (slashMatch) return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`;
  return "";
}

// ---------------------------------------------------------------------------
// Module source context builder
// ---------------------------------------------------------------------------

export function moduleSourceContext(module: StudyTask) {
  return [
    module.source_title ? `资料来源：${module.source_title}` : "",
    module.source_section ? `资料位置：${module.source_section}` : "",
    module.evidence ? `资料证据：${module.evidence}` : "",
    "知识点和考察重点要优先基于上面的资料证据；可以适当补充背景帮助理解，但请标注为“补充理解”，不要把补充内容说成资料原文。"
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Status tone
// ---------------------------------------------------------------------------

export function statusTone(message: string) {
  if (/失败|错误|没|先|不能|要填|不足|无响应|失败|异常/.test(message)) return "danger";
  if (/已|完成|成功|保存|加入|导入|生成|记录/.test(message)) return "success";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Practice question parsing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Card parsing from AI response
// ---------------------------------------------------------------------------

const VALID_CARD_TYPES: CardType[] = ["concept", "mistake", "exam", "quick_memory"];

export function parseCardsFromAi(content: string): LearnCard[] {
  const jsonTexts = getJsonArrayTexts(content);
  if (!jsonTexts.length) return [];
  try {
    const data = jsonTexts.flatMap((jsonText) => {
      const parsed = JSON.parse(jsonText);
      return Array.isArray(parsed) ? parsed : [];
    });
    return data.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const type = String(record.type || "concept").trim();
      if (!VALID_CARD_TYPES.includes(type as CardType)) return [];
      const front = stripMarkdown(String(record.front || "").trim());
      if (!front || front.length < 2) return [];
      const backObj = record.back;
      const back = typeof backObj === "object" && backObj !== null
        ? {
            answer: stripMarkdown(String((backObj as Record<string, unknown>).answer || "").trim()),
            examAnswer: stripMarkdown(String((backObj as Record<string, unknown>).examAnswer || "").trim()) || undefined,
            memoryTip: stripMarkdown(String((backObj as Record<string, unknown>).memoryTip || "").trim()) || undefined,
          }
        : { answer: stripMarkdown(String(record.answer || record.back || "").trim()) };
      if (!back.answer) return [];
      const importance = typeof record.importance === "number" && record.importance >= 1 && record.importance <= 5
        ? record.importance : 3;
      return [{
        id: `card-${index}-${Date.now()}`,
        type: type as CardType,
        front,
        back,
        importance,
      }];
    });
  } catch {
    return [];
  }
}


export function parsePracticeQuestions(text: string): string[] {
  const cleaned = stripMarkdown(text);
  const questions: string[] = [];
  const parts = cleaned.split(/(?=(?:^|\n)\d+\s*[.、）)])/);
  parts.forEach((part) => {
    const trimmed = part.trim();
    if (trimmed && /^\d/.test(trimmed)) {
      questions.push(trimmed);
    }
  });
  return questions.length >= 2 ? questions : [cleaned];
}

function splitChoiceOptions(line: string) {
  return line
    .split(/\s+(?=[A-Ea-e][.．、]\s*)/)
    .map((part) => part.trim())
    .filter((part) => /^[A-Ea-e][.．、]/.test(part));
}

export function parseMockQuestions(content: string): ParsedMockPaper {
  const sections = content.split("【题目解析】");
  const examPart = sections[0] || content;
  const answerPart = sections.length > 1 ? sections.slice(1).join("\n").trim() : "";

  const questions: ParsedQuestion[] = [];
  const lines = examPart.split("\n");
  let currentSectionType: "choice" | "essay" = "essay";
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) { i++; continue; }

    if (/^[一二三四五六七八九十]+[、.．]/.test(trimmed) && /选择/.test(trimmed)) {
      currentSectionType = "choice";
      i++; continue;
    }
    if (/^[一二三四五六七八九十]+[、.．]/.test(trimmed) && /简答|问答|论述|计算|填空/.test(trimmed)) {
      currentSectionType = "essay";
      i++; continue;
    }

    if (/^\d+[.、）]/.test(trimmed) && !/^[一二三四五六七八九十]、/.test(trimmed)) {
      const question = trimmed;
      let options: string[] | undefined;

      if (currentSectionType === "choice") {
        options = [];
        const nextIdx = i + 1;
        let j = nextIdx;
        while (j < lines.length && j < nextIdx + 8) {
          const optLine = lines[j].trim();
          if (/^[A-Ea-e][.．、]/.test(optLine) && optLine.length < 200) {
            options.push(...splitChoiceOptions(optLine));
            j++;
          } else if (optLine === "" || /^\d+[.、）]/.test(optLine) || /^[一二三四五六七八九十]+[、.．]/.test(optLine)) {
            break;
          } else {
            break;
          }
        }
        i = j - 1;
      }

      questions.push({ type: currentSectionType, question, options });
    }

    i++;
  }

  return { questions, answerKey: answerPart };
}

export function extractMistakesFromGrading(gradingText: string): string[] {
  const lines = gradingText.split(/\n/);
  const mistakes: string[] = [];
  let currentQ = "";
  for (const line of lines) {
    if (/^第?\s*\d+\s*[.、题]|^题目|\n\d+[.、)]/.test(line)) {
      if (currentQ && /[✗×错]|误|不对|扣分|不正确/.test(currentQ)) {
        mistakes.push(currentQ.replace(/\s+/g, " ").trim().slice(0, 200));
      }
      currentQ = line;
    } else {
      currentQ += " " + line;
    }
  }
  if (currentQ && /[✗×错]|误|不对|扣分|不正确/.test(currentQ)) {
    mistakes.push(currentQ.replace(/\s+/g, " ").trim().slice(0, 200));
  }
  return mistakes.slice(0, 10);
}

/** Per-question grading verdict after mock exam scoring. */
export type GradingVerdict = "correct" | "partial" | "wrong" | "unknown";

export function gradePerQuestion(gradingText: string, questionCount: number): GradingVerdict[] {
  const verdicts: GradingVerdict[] = new Array(questionCount);
  for (let i = 0; i < questionCount; i++) verdicts[i] = "unknown";

  function setVerdict(idx: number, marker: string) {
    const v = marker === "✓" || marker === "✔" ? "correct"
      : marker === "✗" || marker === "✘" || marker === "×" ? "wrong"
      : marker === "△" ? "partial"
      : "unknown";
    if (v !== "unknown") verdicts[idx] = v;
  }

  // Parse the structured format: 第N题【✓/✗/△】
  const re = /第\s*(\d+)\s*题\s*【([✓✗△✘×✔])】/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(gradingText)) !== null) {
    const qNum = parseInt(match[1], 10);
    const idx = qNum - 1;
    if (idx < 0 || idx >= questionCount) continue;
    setVerdict(idx, match[2]);
  }

  // Fallback: try numbered format "1. ✓", "1. ✗", "1. △"
  if (verdicts.every(v => v === "unknown")) {
    const fallbackRe = /(?:^|\n)\s*(\d+)\s*[.、．）]\s*([✓✗△✘×✔])/gm;
    while ((match = fallbackRe.exec(gradingText)) !== null) {
      const qNum = parseInt(match[1], 10);
      const idx = qNum - 1;
      if (idx < 0 || idx >= questionCount) continue;
      setVerdict(idx, match[2]);
    }
  }

  return verdicts;
}
// ---------------------------------------------------------------------------
// Status tone
// ---------------------------------------------------------------------------
