import assert from "node:assert/strict";
import test from "node:test";
import { parseModulesFromPlan, parseDailyPlan, buildBalancedDailyPlan } from "../../src/utils.ts";
import type { StudyProject, StudyTask } from "../../src/types.ts";

const project: StudyProject = {
  id: "p1",
  subject: "测试",
  exam_date: "2026-12-31",
  daily_minutes: 120,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

test("parseModulesFromPlan handles empty content", () => {
  const result = parseModulesFromPlan("", project.id, "note-1", 0, () => "id1");
  assert.deepEqual(result, []);
});

test("parseModulesFromPlan handles plain text with no modules", () => {
  // Text fallback: non-JSON text is treated as a single module description.
  const result = parseModulesFromPlan(
    "这是一段没有模块信息的文本。",
    project.id, "note-1", 0, () => "id1"
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.note, "这是一段没有模块信息的文本。");
});

test("parseModulesFromPlan handles malformed JSON gracefully", () => {
  // Falls through to text-format parsing when JSON is invalid.
  // It treats the input as a plain-text module description (stored in .note).
  const result = parseModulesFromPlan(
    "[{title: 进程, 缺少引号}]",
    project.id, "note-1", 0, () => "id1"
  );
  // Should not throw, and the result may include a text-fallback module.
  assert.ok(Array.isArray(result));
});

test("parseModulesFromPlan extracts single module from JSON", () => {
  const result = parseModulesFromPlan(
    JSON.stringify([{
      title: "进程管理",
      estimated_minutes: 45,
      difficulty: "中",
      importance_rank: 1,
      exam_points: "进程状态转换",
      sourceTitle: "操作系统课件",
      evidence: "资料第3章列出进程状态",
    }]),
    project.id, "note-1", 0, () => "module-proc"
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.title, "进程管理");
  assert.equal(result[0]?.estimated_minutes, 45);
  assert.equal(result[0]?.source_title, "操作系统课件");
});

test("parseModulesFromPlan handles text-format modules", () => {
  const result = parseModulesFromPlan(
    "模块名称：进程；预计时间：45分钟；难度：中；重要排名：1；资料来源：进程课件；证据：PCB 记录进程状态；考察内容：PCB、状态转换、调度；练习方式：做状态转换题",
    project.id, "note-1", 0, () => "module-text"
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.title, "进程");
  assert.equal(result[0]?.estimated_minutes, 45);
});

test("parseModulesFromPlan keeps large text-format module lists", () => {
  let id = 0;
  const names = ["进程", "线程", "死锁", "分页", "分段", "页面置换", "文件目录", "磁盘调度", "虚拟存储", "银行家算法"];
  const content = Array.from({ length: 700 }, (_, index) => {
    const name = `${names[index % names.length]}${Math.floor(index / names.length) + 1}`;
    return `模块名称：${name}；预计时间：45分钟；难度：中；重要排名：${index + 1}；资料来源：课件；证据：第${index + 1}页`;
  }).join("\n");

  const result = parseModulesFromPlan(content, project.id, "note-1", 0, () => `module-${++id}`);

  assert.equal(result.length, 700);
  assert.equal(result.at(-1)?.title, "银行家算法70");
});

test("parseModulesFromPlan merges duplicate example-titled modules", () => {
  const result = parseModulesFromPlan(
    JSON.stringify([
      {
        title: "P,V操作实现独木桥问题",
        estimated_minutes: 45,
        difficulty: "高",
        importance_rank: 1,
        exam_points: "互斥通行",
        sourceTitle: "题库",
        evidence: "资料给出独木桥问题",
      },
      {
        title: "P,V操作实现水果盘问题",
        estimated_minutes: 45,
        difficulty: "高",
        importance_rank: 2,
        exam_points: "生产者消费者",
        sourceTitle: "题库",
        evidence: "资料给出水果盘问题",
      },
    ]),
    project.id, "note-1", 0, () => "module-pv"
  );
  assert.equal(result.length, 1);
  assert.ok(result[0]?.title.includes("信号量"));
  assert.ok(
    result[0]?.exam_points?.includes("独木桥") ||
    result[0]?.note?.includes("独木桥")
  );
});

test("parseDailyPlan handles empty array", () => {
  assert.deepEqual(parseDailyPlan("[]"), []);
});

test("parseDailyPlan handles non-JSON gracefully", () => {
  assert.deepEqual(parseDailyPlan("不是JSON"), []);
});

test("buildBalancedDailyPlan with no parsed plan items falls back to auto-spread", () => {
  const modules: StudyTask[] = [
    {
      id: "m1", project_id: project.id, title: "进程",
      date: "", estimated_minutes: 60, status: "todo", module_status: "todo",
      importance_rank: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  const plan = buildBalancedDailyPlan(modules, project, "2026-06-07", []);
  assert.equal(plan.length, 1);
  assert.equal(plan[0]?.module_id, "m1");
  assert.ok(plan[0]?.date);
});
