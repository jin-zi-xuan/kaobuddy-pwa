import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft, BookOpen, Brain, Cards, ChartDonut, CheckCircle, ClipboardText,
  ClockCountdown, DownloadSimple, FileArrowUp, GearSix, Kanban, Key,
  Lightning, ListChecks, Notebook, PencilSimple, PlusCircle, ShieldCheck,
  Sparkle, StackPlus, Target, Ticket, Timer, Trash, UploadSimple, Video
} from "@phosphor-icons/react";
import { assertImageRecognitionSupported, gradeMock, gradePractice, importVideo, recognizeHandwriting, runAi, runCardsStream, runDailyPlan, runMemorize, runModulePractice, testApiConfig, verifyInviteCode, type AiAuthPayload, type AiResult } from "./api";
import { BrandMark, RenderHumanText, StatusToast } from "./components/Common";
import { readAsDataUrl, readDocumentText, readPdfText, readPresentationText, readTextFile } from "./fileReaders";
import { getGenerationGuard } from "./generationGuards";
import { applyInviteVerification, isInviteReady, updateInviteCodeDraft } from "./inviteState";
import { exportMockExamPdf } from "./pdfExport";
import { projectTextDraft, updateProjectTextDraft } from "./projectDrafts";
import { createId, storage } from "./storage";
import type {
  AiNote, AiMode, ApiConfig, CardProgress, InviteState, LearnCard,
  MaterialKind, Mistake, MistakeFilter, MockAttempt, ProviderPreset,
  StudyMaterial, StudyProject, StudyTask, WeakPoint
} from "./types";
import {
  compactTitle, dateKey, dateLabel, daysLeft, difficultyLabel,
  displayModuleTitle, extractModuleTitle, gradePerQuestion, humanReadableAiText,
  isStudyModule,
  materialKindLabel, moduleKey, moduleOnlyBelongsToMaterial,
  learningButtonAction, moduleImportanceLabel, moduleSourceContext, moduleStatus, normalizeMinutes, nowIso,
  buildBalancedDailyPlan, buildDailyPlanGroups, decideCardSwipe, normalizeMockDuration, parseCardsFromAi, parseDailyPlan, parseDifficulty, parseMockQuestions,
  parseModulesFromPlan, parsePracticeQuestions, parsePriority,
  parseRequestedMockDuration, statusTone, stripMarkdown, taskOrder, toProjectPayload,
  type ModuleStatus
} from "./utils";
import { buildAiAuthPayload, resolveEffectiveInviteState } from "./aiAuth";
import { useCardLearning } from "./useCardLearning";

type ProjectTab = "overview" | "materials" | "plan" | "mock" | "gap" | "module" | "result" | "review";
type SetupStep = "intro" | "flow" | "api" | "project";
type UploadQueueItem = {
  id: string;
  name: string;
  state: "reading" | "vision" | "done" | "failed";
  message: string;
};

const presets: ProviderPreset[] = [
  { provider_name: "DeepSeek", base_url: "https://api.deepseek.com", model: "deepseek-v4-pro" },
  { provider_name: "Kimi 国内", base_url: "https://api.moonshot.cn/v1", model: "kimi-k2.6" },
  { provider_name: "Kimi 国际", base_url: "https://api.moonshot.ai/v1", model: "kimi-k2.6" },
  { provider_name: "OpenAI", base_url: "https://api.openai.com/v1", model: "gpt-5.5" },
  { provider_name: "自定义", base_url: "https://", model: "" }
];

const defaultApiConfig: ApiConfig = {
  ...presets[0],
  api_key: "",
  temperature: 0.4,
  max_tokens: 1800
};

const emptyProject = {
  subject: "",
  exam_date: "",
  daily_minutes: 120,
  target_score: "",
  weak_points: ""
};

const emptyMistake = {
  question: "",
  reason: "",
  fix: ""
};

const emptyWeakPoint: Pick<WeakPoint, "title" | "evidence" | "severity"> = {
  title: "",
  evidence: "",
  severity: "medium"
};

const moduleColumns: { status: ModuleStatus; title: string; hint: string }[] = [
  { status: "todo", title: "待学习", hint: "按照重要程度排序" },
  { status: "doing", title: "学习中", hint: "正在学的内容" },
  { status: "done", title: "已学习", hint: "已经学完的模块" }
];

const visibleTabs: { tab: ProjectTab; label: string }[] = [
  { tab: "overview", label: "总览" },
  { tab: "materials", label: "资料" },
  { tab: "plan", label: "计划" },
  { tab: "mock", label: "模拟考" },
  { tab: "gap", label: "查漏补缺" },
  { tab: "review", label: "临考速背" }
];

const setupSteps: { step: SetupStep; label: string }[] = [
  { step: "intro", label: "认识考搭子" },
  { step: "flow", label: "使用流程" },
  { step: "api", label: "连接 AI" },
  { step: "project", label: "创建项目" }
];

const tabIcons: Record<ProjectTab, typeof ChartDonut> = {
  overview: ChartDonut,
  materials: FileArrowUp,
  plan: Kanban,
  mock: ClipboardText,
  gap: Target,
  module: Brain,
  result: Sparkle,
  review: Cards
};

const setupIcons: Record<SetupStep, typeof Sparkle> = {
  intro: Sparkle,
  flow: ListChecks,
  api: ShieldCheck,
  project: Target
};


export default function App() {
  const [apiConfig, setApiConfig] = useState<ApiConfig>(storage.getApiConfig() || defaultApiConfig);
  const [inviteState, setInviteState] = useState<InviteState>(() => storage.getInviteState());
  const [showAdvancedApi, setShowAdvancedApi] = useState(false);
  const [projects, setProjects] = useState<StudyProject[]>([]);
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [notes, setNotes] = useState<AiNote[]>([]);
  const [tasks, setTasks] = useState<StudyTask[]>([]);
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [weakPoints, setWeakPoints] = useState<WeakPoint[]>([]);
  const [mockAttempts, setMockAttempts] = useState<MockAttempt[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeTab, setActiveTab] = useState<ProjectTab>("overview");
  const [projectDraft, setProjectDraft] = useState(emptyProject);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [handwritingHint, setHandwritingHint] = useState("");
  const [extraDrafts, setExtraDrafts] = useState<Record<string, string>>({});
  const [mistakeDraft, setMistakeDraft] = useState(emptyMistake);
  const [weakPointDraft, setWeakPointDraft] = useState(emptyWeakPoint);
  const [mockQuestionTypes, setMockQuestionTypes] = useState("");
  const [mockDuration, setMockDuration] = useState<number>(0);
  const [mockMode, setMockMode] = useState<"text" | "answer">("text");
  const [editingMockId, setEditingMockId] = useState("");
  const [draggingModuleId, setDraggingModuleId] = useState("");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [memorizeModuleId, setMemorizeModuleId] = useState("");
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [lastDismissedId, setLastDismissedId] = useState("");
  const [dismissingId, setDismissingId] = useState("");
  const [planMode, setPlanMode] = useState<"modules" | "daily">("modules");
  const [generationAbort, setGenerationAbort] = useState<AbortController | null>(null);
  const [mistakeFilter, setMistakeFilter] = useState<MistakeFilter>("all");
  const [expandedMistakeId, setExpandedMistakeId] = useState("");
  const [editingMistakeId, setEditingMistakeId] = useState("");
  const [editingWeakPointId, setEditingWeakPointId] = useState("");
  const {
    cardProgress, setCardProgress, cardLearningRound, setCardLearningRound,
    currentCardIndex, setCurrentCardIndex, isCardFlipped, setIsCardFlipped,
    cardDragLock, cardQueue, setCardQueue, streamingCards, isStreamingCards, streamingAbort,
    setStreamingCards, setIsStreamingCards, setStreamingAbort,
    resetCardProgress, markCard, goToNextCard, goToPrevCard, flipCard,
    cancelStreaming, loadSavedCards, saveCardsToModule,
  } = useCardLearning();
  const [showPracticeGrading, setShowPracticeGrading] = useState(false);
  const [practiceGradingNote, setPracticeGradingNote] = useState<AiNote | null>(null);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, string>>({});
  const [mockExamState, setMockExamState] = useState<"list" | "taking" | "scored">("list");
  const [activeMockAttempt, setActiveMockAttempt] = useState<MockAttempt | null>(null);
  const [mockUserAnswers, setMockUserAnswers] = useState<Record<string, string>>({});
  const [mockScoringResult, setMockScoringResult] = useState<string | null>(null);
  const [selectedMockMistakes, setSelectedMockMistakes] = useState<number[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [resultNote, setResultNote] = useState<AiNote | null>(null);
  const [status, setStatus] = useState("准备好了。");
  const [busyLabel, setBusyLabel] = useState("");
  const [setupStep, setSetupStep] = useState<SetupStep>("intro");
  const [showSetup, setShowSetup] = useState(false);

  async function refresh() {
    const [projectRows, materialRows, noteRows, taskRows, mistakeRows, weakPointRows, mockRows] = await Promise.all([
      storage.projects(),
      storage.materials(),
      storage.notes(),
      storage.tasks(),
      storage.mistakes(),
      storage.weakPoints(),
      storage.mockAttempts()
    ]);
    setProjects(projectRows.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    setMaterials(materialRows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setNotes(noteRows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setTasks(taskRows.sort((a, b) => taskOrder(a, 0) - taskOrder(b, 0)));
    setMistakes(mistakeRows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setWeakPoints(weakPointRows.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    setMistakes(mistakeRows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setWeakPoints(weakPointRows.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    setMockAttempts(mockRows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    if (!activeProjectId && projectRows[0]) setActiveProjectId(projectRows[0].id);
  }

  useEffect(() => {
    refresh();
  }, []);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || projects[0],
    [activeProjectId, projects]
  );
  const activeProjectDraftId = activeProject?.id || "";
  const extra = projectTextDraft(extraDrafts, activeProjectDraftId);

  function setExtra(value: string) {
    setExtraDrafts((current) => updateProjectTextDraft(current, activeProjectDraftId, value));
  }

  const scopedMaterials = useMemo(
    () => materials.filter((item) => item.project_id === activeProject?.id),
    [materials, activeProject]
  );
  const scopedNotes = useMemo(
    () => notes.filter((item) => item.project_id === activeProject?.id),
    [notes, activeProject]
  );
  const scopedModules = useMemo(
    () => tasks.filter((item) => item.project_id === activeProject?.id).sort((a, b) => taskOrder(a, 0) - taskOrder(b, 0)),
    [tasks, activeProject]
  );
  const visibleModules = useMemo(
    () => scopedModules.filter(isStudyModule),
    [scopedModules]
  );
  const scopedMistakes = useMemo(
    () => mistakes.filter((item) => item.project_id === activeProject?.id),
    [mistakes, activeProject]
  );
  const visibleMistakes = useMemo(
    () => scopedMistakes.filter((item) => mistakeFilter === "all" || item.status === mistakeFilter),
    [scopedMistakes, mistakeFilter]
  );
  const scopedWeakPoints = useMemo(
    () => weakPoints.filter((item) => item.project_id === activeProject?.id),
    [weakPoints, activeProject]
  );
  const scopedMocks = useMemo(
    () => mockAttempts.filter((item) => item.project_id === activeProject?.id),
    [mockAttempts, activeProject]
  );
  const completedModules = visibleModules.filter((item) => moduleStatus(item) === "done").length;
  const progress = visibleModules.length ? Math.round((completedModules / visibleModules.length) * 100) : 0;
  const busy = Boolean(busyLabel);
  const currentFocusModule = visibleModules.find((item) => moduleStatus(item) !== "done");
  const todayKey = dateKey();
  const todayModules = useMemo(
    () => visibleModules.filter((item) => item.date === todayKey && moduleStatus(item) !== "done"),
    [visibleModules, todayKey]
  );
  const overdueModules = useMemo(
    () => visibleModules.filter((item) => item.date && item.date < todayKey && moduleStatus(item) !== "done"),
    [visibleModules, todayKey]
  );
  const dailyPlanGroups = useMemo(() => {
    return buildDailyPlanGroups(visibleModules, activeProject, todayKey);
  }, [activeProject, visibleModules, todayKey]);
  const hasDailyPlan = dailyPlanGroups.some((group) => group.items.length > 0);
  const selectedModule = selectedModuleId
    ? scopedModules.find((item) => item.id === selectedModuleId) || null
    : null;
  const latestPlanNote = scopedNotes.find((note) => note.mode === "plan");
  const currentResultNote = resultNote || scopedNotes[0] || null;
  const activeMockNote = activeMockAttempt?.source_note_id
    ? scopedNotes.find((note) => note.id === activeMockAttempt.source_note_id) || null
    : null;
  const activeMockPaper = activeMockNote ? parseMockQuestions(activeMockNote.content) : { questions: [], answerKey: "" };
  const mockQuestionVerdicts = mockScoringResult && activeMockPaper.questions.length
    ? gradePerQuestion(mockScoringResult, activeMockPaper.questions.length)
    : [];
  const mockMistakeCandidates = activeMockPaper.questions
    .map((q, i) => ({ index: i, question: q, verdict: mockQuestionVerdicts[i] || "unknown" as const }));
  const statusMessage = busy ? busyLabel : status;
  const statusClass = `status ${busy ? "loading" : statusTone(statusMessage)}`;
  function latestInviteState() {
    return resolveEffectiveInviteState(inviteState, storage.getInviteState());
  }

  function getAuthPayload(): AiAuthPayload {
    return buildAiAuthPayload(latestInviteState(), apiConfig);
  }

  function projectProgress(projectId: string) {
    const projectModules = tasks.filter((task) => task.project_id === projectId && isStudyModule(task));
    if (!projectModules.length) return 0;
    return Math.round((projectModules.filter((task) => moduleStatus(task) === "done").length / projectModules.length) * 100);
  }

  function requireApi() {
    if (!apiConfig.api_key.trim()) {
      setStatus("先填 API Key，再让 AI 干活。");
      return false;
    }
    if (!apiConfig.base_url.trim() || !apiConfig.model.trim()) {
      setStatus("高级设置里的 Base URL 和 Model 还没填完整。");
      setShowAdvancedApi(true);
      return false;
    }
    return true;
  }

  function requireAi() {
    const currentInviteState = latestInviteState();
    if (currentInviteState.aiMode === "invite") {
      if (currentInviteState !== inviteState) setInviteState(currentInviteState);
      if (!currentInviteState.inviteCode.trim()) {
        setStatus("先填邀请码，再让 AI 干活。");
        return false;
      }
      if (!isInviteReady(currentInviteState)) {
        setStatus("先验证邀请码，再让 AI 干活。");
        return false;
      }
      return true;
    }
    return requireApi();
  }

  function saveInviteState(nextState: InviteState) {
    setInviteState(nextState);
    storage.saveInviteState(nextState);
  }

  async function verifyInvite() {
    const code = inviteState.inviteCode.trim();
    if (!code) return setStatus("先填邀请码。");
    setBusyLabel("正在验证邀请码...");
    try {
      const result = await verifyInviteCode(code);
      const nextState = applyInviteVerification(inviteState, code, result, nowIso());
      saveInviteState(nextState);
      setStatus(result.valid ? "邀请码验证成功，AI 已连接。" : result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "邀请码验证失败。");
    } finally {
      setBusyLabel("");
    }
  }

  function requireProject() {
    if (!activeProject) {
      setStatus("先创建一个考试项目。");
      return false;
    }
    return true;
  }

  function updateUploadItem(id: string, patch: Partial<UploadQueueItem>) {
    setUploadQueue((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function updatePreset(providerName: string) {
    const preset = presets.find((item) => item.provider_name === providerName) || presets[0];
    setApiConfig({ ...apiConfig, ...preset });
    setShowAdvancedApi(preset.provider_name === "自定义");
  }

  async function saveApi(event?: FormEvent) {
    event?.preventDefault();
    storage.saveApiConfig(apiConfig);
    saveInviteState({ ...inviteState, aiMode: "custom" });
    setStatus("API 配置成功，已保存在当前浏览器。");
  }

  async function testApi() {
    if (!requireApi()) return;
    setBusyLabel("正在测试连接...");
    try {
      const result = await testApiConfig(apiConfig);
      storage.saveApiConfig(apiConfig);
      saveInviteState({ ...inviteState, aiMode: "custom" });
      setStatus("API 连接成功，配置已完成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "连接测试失败。");
    } finally {
      setBusyLabel("");
    }
  }

  function goSetupNext() {
    if (setupStep === "intro") {
      setSetupStep("flow");
      setStatus("先看一遍流程，然后连接 AI。");
      return;
    }
    if (setupStep === "flow") {
      setSetupStep("api");
      setStatus("下一步先填邀请码，或者连接自己的 API Key。");
      return;
    }
    if (setupStep === "api") {
      if (!requireAi()) return;
      if (latestInviteState().aiMode === "custom") storage.saveApiConfig(apiConfig);
      setSetupStep("project");
      setStatus("AI 连接方式已保存，现在创建第一个考试项目。");
    }
  }

  function goSetupBack() {
    if (setupStep === "project") setSetupStep("api");
    if (setupStep === "api") setSetupStep("flow");
    if (setupStep === "flow") setSetupStep("intro");
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    const editingProject = projects.find((project) => project.id === editingProjectId);
    if (!editingProject && !projects.length && !requireAi()) {
      setSetupStep("api");
      return;
    }
    if (!projectDraft.subject.trim()) return setStatus("科目要填一下，比如高数、法考、期末英语。");
    if (!projectDraft.exam_date) return setStatus("考试日期也要填，不然我没法算倒计时。");
    const timestamp = nowIso();
    const project: StudyProject = {
      id: editingProject?.id || createId("project"),
      ...projectDraft,
      subject: projectDraft.subject.trim(),
      daily_minutes: normalizeMinutes(projectDraft.daily_minutes),
      target_score: projectDraft.target_score.trim(),
      weak_points: projectDraft.weak_points.trim(),
      created_at: editingProject?.created_at || timestamp,
      updated_at: timestamp
    };
    await storage.saveProject(project);
    setProjectDraft(emptyProject);
    setEditingProjectId("");
    setActiveProjectId(project.id);
    setActiveTab("overview");
    setShowNewProject(false);
    setShowSetup(false);
    setStatus(editingProject ? "项目基本信息已更新。" : "考试项目已创建。");
    await refresh();
  }

  function editProject(project: StudyProject) {
    setEditingProjectId(project.id);
    setProjectDraft({
      subject: project.subject,
      exam_date: project.exam_date,
      daily_minutes: project.daily_minutes,
      target_score: project.target_score || "",
      weak_points: project.weak_points || ""
    });
    setShowNewProject(true);
    setStatus("可以重新填写这个项目的基本信息。");
  }

  async function deleteProject(project: StudyProject) {
    const ok = window.confirm(`删除「${project.subject}」吗？这个项目里的资料、计划、模拟考和复盘记录也会一起删除。`);
    if (!ok) return;
    await storage.deleteProject(project.id);
    if (activeProjectId === project.id) {
      const nextProject = projects.find((item) => item.id !== project.id);
      setActiveProjectId(nextProject?.id || "");
      setActiveTab("overview");
      setSelectedModuleId("");
      setResultNote(null);
    }
    if (editingProjectId === project.id) {
      setEditingProjectId("");
      setProjectDraft(emptyProject);
      setShowNewProject(false);
    }
    setStatus("项目已删除。");
    await refresh();
  }

  async function handleFiles(files: FileList | null) {
    if (!requireProject()) return;
    if (!files?.length) return setStatus("先选择要上传的课件或教材。");
    const selected = Array.from(files);
    const queueItems: UploadQueueItem[] = selected.map((file) => ({
      id: createId("upload"),
      name: file.name,
      state: "reading",
      message: "正在读取文件"
    }));
    setUploadQueue((items) => [...queueItems, ...items].slice(0, 12));
    setBusyLabel(`正在导入 ${selected.length} 个文件...`);
    try {
      let successCount = 0;
      for (const [index, file] of selected.entries()) {
        const queueId = queueItems[index].id;
        try {
          const lower = file.name.toLowerCase();
          const isDocument = lower.endsWith(".doc") || lower.endsWith(".docx") || lower.endsWith(".odt") || lower.endsWith(".rtf");
          const isPresentation = lower.endsWith(".ppt") || lower.endsWith(".pptx");
          const kind: MaterialKind = lower.endsWith(".pdf")
            ? "pdf"
            : lower.endsWith(".md") || lower.endsWith(".markdown")
              ? "markdown"
              : isDocument || isPresentation
                ? "document"
                : "file";
          let content = "";
          const warnings: string[] = [];
          if (kind === "pdf") {
            updateUploadItem(queueId, { state: "reading", message: "正在快速读取 PDF 文字层" });
            const text = await readPdfText(file);
            content = `PDF 文字层\n${text || "没有提取到文字层。扫描版 PDF 可以后续补充手动重点。"}`;
            warnings.push("已快速导入 PDF 文字层；扫描图片、图表和公式识别会放到后续单独处理。");
          } else {
            if (isPresentation) {
              updateUploadItem(queueId, { state: "reading", message: "正在读取 PPTX 文字层" });
              content = await readPresentationText(file);
            } else if (kind === "document") {
              updateUploadItem(queueId, { state: "reading", message: "正在读取文档正文" });
              content = await readDocumentText(file);
            } else {
              content = await readTextFile(file);
            }
          }
          await storage.saveMaterial({
            id: createId("material"),
            project_id: activeProject!.id,
            title: file.name,
            kind,
            content,
            file_name: file.name,
            warnings,
            created_at: nowIso()
          });
          successCount += 1;
          updateUploadItem(queueId, { state: "done", message: kind === "pdf" ? "已快速导入 PDF 文字层" : isPresentation ? "已导入 PPTX 文字层" : kind === "document" ? "已导入文档正文" : "已导入资料库" });
        } catch (error) {
          updateUploadItem(queueId, { state: "failed", message: error instanceof Error ? error.message : "导入失败" });
        }
      }
      setStatus(`已导入 ${successCount} 个文件。${successCount < selected.length ? "有文件失败，队列里可以看到原因。" : "下一步去计划页生成知识点模块。"}`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "文件读取失败。");
    } finally {
      setBusyLabel("");
    }
  }

  async function handleHandwriting(files: FileList | null) {
    if (!requireProject()) return;
    if (!files?.length) return setStatus("先选择手写图片或 PDF。");
    if (!requireAi()) return;
    setBusyLabel("正在识别手写笔记...");
    try {
      const selected = Array.from(files).slice(0, 6);
      const pdfFiles = selected.filter((file) => file.name.toLowerCase().endsWith(".pdf"));
      const imageFiles = selected.filter((file) => !file.name.toLowerCase().endsWith(".pdf"));
      const authPayload = getAuthPayload();
      if (imageFiles.length) assertImageRecognitionSupported(authPayload);
      const pdfText = (await Promise.all(pdfFiles.map(readPdfText))).join("\n\n");
      const imageDataUrls = await Promise.all(imageFiles.map(readAsDataUrl));
      const recognized = imageDataUrls.length ? await recognizeHandwriting(authPayload, imageDataUrls, handwritingHint) : null;
      await storage.saveMaterial({
        id: createId("material"),
        project_id: activeProject!.id,
        title: handwritingHint.trim() || "手写笔记",
        kind: "handwriting",
        content: [recognized?.content || "", pdfText].filter(Boolean).join("\n\n") || "这份手写资料暂时没有识别出文本，请手动补充重点。",
        image_data_urls: imageDataUrls,
        created_at: nowIso()
      });
      setStatus("手写笔记识别完成，已保存到资料库。下一步去计划页生成知识点模块。");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "手写识别失败。");
    } finally {
      setBusyLabel("");
    }
  }

  async function handleVideoImport() {
    if (!requireProject()) return;
    if (!videoUrl.trim()) return setStatus("先粘贴视频链接。");
    if (!/^https?:\/\/\S+$/i.test(videoUrl.trim())) return setStatus("这里要粘贴完整视频链接，比如 https://www.bilibili.com/video/...。");
    setBusyLabel("正在读取视频公开信息...");
    try {
      const result = await importVideo(videoUrl.trim());
      const content = [result.description, result.subtitles].filter(Boolean).join("\n\n");
      await storage.saveMaterial({
        id: createId("material"),
        project_id: activeProject!.id,
        title: result.title || "视频资料",
        kind: "video",
        content: [result.description, result.subtitles].filter(Boolean).join("\n\n") || "没有抓到字幕。请手动补充这条视频的课程重点或字幕。",
        source_url: result.source_url,
        warnings: result.warnings,
        created_at: nowIso()
      });
      setVideoUrl("");
      setStatus(result.subtitles ? "视频字幕已导入资料库。下一步去计划页生成知识点模块。" : result.warnings[0] || "视频信息已保存，但没有抓到公开字幕。下一步可以去计划页生成知识点模块。");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "视频导入失败。");
    } finally {
      setBusyLabel("");
    }
  }

  async function runMode(mode: "plan" | "teach" | "practice" | "mock-exam", title: string, extraOverride?: string, mockDurationOverride?: number) {
    if (!requireProject()) return;
    const generationGuard = getGenerationGuard({ mode, materialCount: scopedMaterials.length });
    if (generationGuard) {
      setStatus(generationGuard.status);
      setActiveTab(generationGuard.nextTab);
      return;
    }
    if (!requireAi()) return;
    setBusyLabel(`正在生成${title}...`);
    const abort = new AbortController();
    setGenerationAbort(abort);
    try {
      const result = await runAi(mode, {
        ...getAuthPayload(),
        project: toProjectPayload(activeProject!),
        materials: scopedMaterials.map(({ id, title, kind, content }) => ({ id, title, kind, content })),
        extra: extraOverride ?? extra
      }, abort.signal);
      const note: AiNote = {
        id: createId("note"),
        project_id: activeProject!.id,
        mode: mode === "mock-exam" ? "mock" : mode,
        title,
        content: result.content,
        created_at: nowIso()
      };
      await storage.saveNote(note);
      let mockAttempt: MockAttempt | null = null;
      if (mode === "mock-exam") {
        const durationMinutes = mockDurationOverride ?? parseRequestedMockDuration(extraOverride || extra || "", 30);
        mockAttempt = {
          id: createId("mock"),
          project_id: activeProject!.id,
          title: `模拟考 ${new Date().toLocaleDateString("zh-CN")} ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
          score: "",
          duration_minutes: durationMinutes,
          feedback: "",
          source_note_id: note.id,
          test_mode: mockMode,
          created_at: nowIso()
        };
        await storage.saveMockAttempt(mockAttempt);
        setMockDuration(durationMinutes);
      }
      if (mode === "mock-exam" && mockMode === "answer" && mockAttempt) {
        setActiveMockAttempt(mockAttempt);
        setMockUserAnswers({});
        setMockScoringResult(null);
        setSelectedMockMistakes([]);
        setMockExamState("taking");
        setActiveTab("mock");
        setStatus("AI答题模拟考已生成，先做题，提交后再看批改和参考解析。");
      } else if (mode === "plan") {
        setResultNote(note);
        await createModulesFromPlan(note);
      } else {
        setResultNote(note);
        setActiveTab("result");
        setStatus(`${title} 已生成，已经打开结果页。`);
      }
      await refresh();
    } catch (error) {
      if ((error as Error).name === "AbortError") { /* cancelGeneration() already sets status */ }
      else { setStatus(error instanceof Error ? error.message : "AI 请求失败。"); }
    } finally {
      setGenerationAbort(null);
      setBusyLabel("");
    }
  }

  function cancelGeneration() {
    if (generationAbort) {
      generationAbort.abort();
      setGenerationAbort(null);
      setBusyLabel("");
      setStatus("已取消生成。");
    }
  }

  async function generateDailyPlan() {
    if (!requireProject() || !requireAi()) return;
    const unfinished = visibleModules.filter((item) => moduleStatus(item) !== "done");
    if (!unfinished.length) return setStatus("没有需要安排的未完成知识点。");
    setStatus("正在按剩余天数生成每日任务，请耐心等一下。");
    setBusyLabel("正在生成每日计划...");
    const abort = new AbortController();
    setGenerationAbort(abort);
    try {
      const result = await runDailyPlan({
        ...getAuthPayload(),
        project: toProjectPayload(activeProject!),
        modules: unfinished.map((item) => ({
          id: item.id,
          title: displayModuleTitle(item.title, item.note),
          estimated_minutes: item.estimated_minutes,
          difficulty: item.difficulty,
          importance_rank: item.importance_rank,
          exam_points: item.exam_points || item.note || "",
          source_title: item.source_title || "",
          evidence: item.evidence || "",
          module_status: moduleStatus(item) === "doing" ? "doing" : "todo"
        })),
        extra
      }, abort.signal);
      const parsedPlanItems = parseDailyPlan(result.content);
      const moduleMap = new Map(unfinished.map((item) => [item.id, item]));
      const planItems = buildBalancedDailyPlan(unfinished, activeProject!, todayKey, parsedPlanItems);
      const sorted = planItems
        .filter((item) => moduleMap.has(item.module_id))
        .sort((a, b) => a.date.localeCompare(b.date) || a.day_order - b.day_order);
      await Promise.all(sorted.map((planItem, index) => {
        const mod = moduleMap.get(planItem.module_id)!;
        return storage.saveTask({ ...mod, date: planItem.date, order: index, updated_at: nowIso() });
      }));
      setPlanMode("daily");
      setStatus(parsedPlanItems.length ? "每日计划已生成，并按考试日期重新均衡了每天任务。" : "AI 没返回可用日计划，已按考试日期自动排好。");
      await refresh();
    } catch (error) {
      if ((error as Error).name === "AbortError") { /* cancelGeneration() already sets status */ }
      else { setStatus(error instanceof Error ? error.message : "每日计划生成失败。"); }
    } finally {
      setGenerationAbort(null);
      setBusyLabel("");
    }
  }

  async function rescheduleOverdue() {
    if (!overdueModules.length) return;
    await Promise.all(overdueModules.map((m) =>
      storage.saveTask({ ...m, date: todayKey, updated_at: nowIso() })
    ));
    setStatus(`已将 ${overdueModules.length} 个逾期模块挪到今天。`);
    await refresh();
  }

  async function createModulesFromPlan(note: AiNote) {
    if (!activeProject) return;
    const parsed = parseModulesFromPlan(note.content, activeProject.id, note.id, visibleModules.length, () => createId('module'));
    if (!parsed.length) return setStatus("这份计划没拆出进程、线程这类明确知识点名，可以重新生成或手动新增模块。");

    // Build a lookup of existing modules by normalized title key,
    // so regenerating the plan preserves memorization/cards/etc. for modules
    // that already exist instead of creating duplicates.
    const existingByKey = new Map<string, StudyTask>();
    for (const mod of visibleModules) {
      existingByKey.set(moduleKey(mod), mod);
    }

    const matchedOldIds = new Set<string>();
    await Promise.all(parsed.map((item, index) => {
      const newKey = displayModuleTitle(item.title, item.note).replace(/\s+/g, "");
      const existing = existingByKey.get(newKey);

      if (existing) {
        // Module already exists — update metadata from the fresh plan but
        // preserve AI-generated content (memorization, cards, explanations, etc.).
        matchedOldIds.add(existing.id);
        return storage.saveTask({
          ...existing,
          source_note_id: note.id,
          title: item.title,
          difficulty: item.difficulty || existing.difficulty || "medium",
          importance_rank: item.importance_rank || index + 1,
          exam_points: item.exam_points || existing.exam_points || item.note || "",
          estimated_minutes: item.estimated_minutes || existing.estimated_minutes,
          priority: item.priority || existing.priority,
          source_material_id: item.source_material_id || existing.source_material_id,
          source_title: item.source_title || existing.source_title,
          source_section: item.source_section || existing.source_section,
          evidence: item.evidence || existing.evidence,
          note: item.note || existing.note,
          updated_at: nowIso()
        });
      }

      // New module — save fresh.
      return storage.saveTask({
        ...item,
        importance_rank: item.importance_rank || index + 1,
        difficulty: item.difficulty || "medium",
        exam_points: item.exam_points || item.note || ""
      });
    }));

    // Remove modules that no longer appear in the regenerated plan
    // (e.g. because the user removed the underlying material).
    const removed = visibleModules.filter((mod) => !matchedOldIds.has(mod.id));
    if (removed.length > 0) {
      await Promise.all(removed.map((mod) => storage.deleteTask(mod.id)));
    }

    const addedCount = parsed.length - matchedOldIds.size;
    const keptCount = matchedOldIds.size;
    const parts: string[] = [];
    if (addedCount > 0) parts.push(`新增 ${addedCount} 个`);
    if (keptCount > 0) parts.push(`保留 ${keptCount} 个`);
    if (removed.length > 0) parts.push(`移除 ${removed.length} 个`);
    setStatus(`${parts.join("，")} 知识模块已加入计划。`);
    setActiveTab("plan");
    await refresh();
  }

  async function deleteMaterial(item: StudyMaterial) {
    const ok = window.confirm(`删除「${item.title}」吗？删除后生成计划时就不会再使用这份资料。`);
    if (!ok) return;
    await storage.deleteMaterial(item.id);
    setStatus("资料已删除。");
    await refresh();
  }

  async function moveModule(targetStatus: ModuleStatus, beforeId?: string) {
    const dragged = visibleModules.find((item) => item.id === draggingModuleId);
    setDraggingModuleId("");
    if (!dragged) return;
    const withoutDragged = visibleModules.filter((item) => item.id !== dragged.id);
    const updatedDragged: StudyTask = {
      ...dragged,
      status: targetStatus === "done" ? "done" : "todo",
      module_status: targetStatus,
      updated_at: nowIso()
    };
    const targetIndex = beforeId ? withoutDragged.findIndex((item) => item.id === beforeId) : -1;
    const nextModules = [...withoutDragged];
    if (targetIndex >= 0) {
      nextModules.splice(targetIndex, 0, updatedDragged);
    } else {
      nextModules.push(updatedDragged);
    }
    await Promise.all(nextModules.map((item, index) => storage.saveTask({ ...item, order: index, updated_at: item.id === dragged.id ? nowIso() : item.updated_at })));
    setStatus("模块顺序已调整。");
    await refresh();
  }

  async function completeModule(module: StudyTask) {
    await storage.saveTask({ ...module, status: "done", module_status: "done", completed_at: nowIso(), updated_at: nowIso() });
    setStatus("这个知识模块已完成。");
    setSelectedModuleId("");
    setActiveTab("plan");
    await refresh();
  }

  async function startModule(module: StudyTask) {
    await storage.saveTask({ ...module, status: "todo", module_status: "doing", updated_at: nowIso() });
    setStatus("已开始学习这个知识模块。");
    await refresh();
  }

  function openModule(module: StudyTask) {
    setSelectedModuleId(module.id);
    setActiveTab("module");
  }

  async function generateModuleQuestions(module: StudyTask) {
    if (!requireProject() || !requireAi()) return;
    if (!scopedMaterials.length) return setStatus("先导入资料，再生成这个知识点的模拟题。");
    const isRefreshing = Boolean(module.practice_questions);
    setBusyLabel(`正在${isRefreshing ? "换一批" : "生成"}「${displayModuleTitle(module.title, module.note)}」的模拟题...`);
    try {
      const moduleTitle = displayModuleTitle(module.title, module.note);
      const result = await runModulePractice({
        ...getAuthPayload(),
        project: toProjectPayload(activeProject!),
        materials: scopedMaterials.map(({ id, title, kind, content }) => ({ id, title, kind, content })),
        extra,
        module_title: moduleTitle,
        exam_points: module.exam_points || module.note || "请根据资料判断。"
      });
      const updated = {
        ...module,
        practice_questions: stripMarkdown(result.content),
        updated_at: nowIso()
      };
      await storage.saveTask(updated);
      setSelectedModuleId(module.id);
      setStatus(isRefreshing ? "已换成新一批模块模拟题。" : "模块模拟题已生成。");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "模块模拟题生成失败。");
    } finally {
      setBusyLabel("");
    }
  }

  async function generateModuleExplanation(module: StudyTask) {
    if (!requireProject() || !requireAi()) return;
    if (!scopedMaterials.length) return setStatus("先导入资料，再生成这个知识点的讲解。");
    const moduleTitle = displayModuleTitle(module.title, module.note);
    setBusyLabel(`正在生成「${moduleTitle}」的讲解...`);
    try {
      const result = await runAi("teach", {
        ...getAuthPayload(),
        project: toProjectPayload(activeProject!),
        materials: scopedMaterials.map(({ id, title, kind, content }) => ({ id, title, kind, content })),
        extra: [
          extra,
          `只讲解这个知识点：${moduleTitle}`,
          `它的考察内容：${module.exam_points || module.note || "请根据资料判断。"}`,
          "输出给零基础学生直接看的详细讲解：先用生活类比建立直觉，再讲核心概念和符号含义，然后给解题步骤，最后用资料里的具体题目做例题演示并总结易错点。",
          "如果考察内容里有独木桥、水果盘、生产者消费者等题目，它们是这个知识点的例题，不要当成新的知识点标题。"
        ].filter(Boolean).join("\n")
      });
      await storage.saveTask({
        ...module,
        explanation: stripMarkdown(result.content),
        updated_at: nowIso()
      });
      setSelectedModuleId(module.id);
      setStatus("模块讲解已生成。");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "模块讲解生成失败。");
    } finally {
      setBusyLabel("");
    }
  }


  // ---- Card Learning ----

  async function generateCards(module: StudyTask) {
    if (!requireProject() || !requireAi()) return;
    if (!scopedMaterials.length) return setStatus("先导入资料，再生成学习卡片。");
    const moduleTitle = displayModuleTitle(module.title, module.note);
    const abort = new AbortController();
    setStreamingAbort(abort);
    setStreamingCards([]);
    setIsStreamingCards(true);
    setSelectedModuleId(module.id);
    let fullText = "";
    try {
      fullText = await runCardsStream({
        ...getAuthPayload(),
        project: toProjectPayload(activeProject!),
        materials: scopedMaterials.map(({ id, title, kind, content }) => ({ id, title, kind, content })),
        extra: [extra, `当前知识点：${moduleTitle}`, `考察内容：${module.exam_points || module.note || "请根据资料判断。"}`, moduleSourceContext(module)].filter(Boolean).join("\n")
      }, (chunk: string) => {
        fullText += chunk;
        const cards = parseCardsFromAi(fullText);
        if (cards.length) setStreamingCards(cards);
      }, (err: string) => { setStatus(err); }, abort.signal);
    } catch (error) {
      if ((error as Error).name === "AbortError") { setStatus("已取消生成。"); }
      else { setStatus(error instanceof Error ? error.message : "卡片生成失败。"); }
      setIsStreamingCards(false); setStreamingAbort(null); return;
    }
    setIsStreamingCards(false); setStreamingAbort(null);
    const cards = parseCardsFromAi(fullText);
    if (!cards.length) { setStreamingCards([]); return setStatus("AI 没有返回有效的卡片，请重试。"); }
    await storage.saveTask({ ...module, cards, updated_at: nowIso() });
    setStatus(`${cards.length} 张学习卡片已生成。`);
    await refresh();
    setStreamingCards([]);
    startCardLearning({ ...module, cards });
  }

  function startCardLearning(module: StudyTask) {
    if (!module.cards?.length) return;
    const sorted = [...module.cards].sort((a, b) => (a.importance ?? 3) - (b.importance ?? 3));
    resetCardProgress(sorted);
    setSelectedModuleId(module.id); setShowPracticeGrading(false); setPracticeGradingNote(null);
    setStatus("开始学习卡片，点击翻卡查看答案。");
  }

  function handleCardTap(action: () => void) {
    if (cardDragLock.current) return;
    action();
  }

  function finishCardDrag(offsetX: number, velocityX: number) {
    cardDragLock.current = Math.abs(offsetX) > 6 || Math.abs(velocityX) > 120;
    window.setTimeout(() => {
      cardDragLock.current = false;
    }, 120);
    const direction = decideCardSwipe(offsetX, velocityX, currentCardIndex + 1 < cardQueue.length, currentCardIndex > 0);
    if (direction === "next") goToNextCard();
    else if (direction === "prev") goToPrevCard();
  }

  function submitCardFeedback(quality: CardProgress) {
    const card = cardQueue[currentCardIndex];
    if (!card) return;
    setCardProgress(prev => ({ ...prev, [card.id]: quality }));
    setIsCardFlipped(false);
    if (currentCardIndex + 1 < cardQueue.length) { setCurrentCardIndex(currentCardIndex + 1); }
    else { finishRound(); }
  }

  function finishRound() {
    const roundProgress = { ...cardProgress };
    const weak = cardQueue.filter(c => roundProgress[c.id] === "uncertain" || roundProgress[c.id] === "unknown");
    if (weak.length > 0 && cardLearningRound === 1) {
      setCardQueue(weak); setCardLearningRound(2); setCurrentCardIndex(0);
      setIsCardFlipped(false); setCardProgress({});
      setStatus(`第一轮完成！复习 ${weak.length} 张掌握不到位的卡片。`);
    } else {
      const mastered = cardQueue.filter(c => roundProgress[c.id] === "mastered").length;
      setStatus(`学习完成！掌握 ${mastered}/${cardQueue.length} 张卡片。`);
      exitCardLearning();
    }
  }

  function exitCardLearning() {
    setCardQueue([]); setCardProgress({}); setCardLearningRound(1);
    setCurrentCardIndex(0); setIsCardFlipped(false);
  }

  async function generateMemorizationContent(module: StudyTask) {
    if (!requireProject() || !requireAi()) return;
    const moduleTitle = displayModuleTitle(module.title, module.note);
    setBusyLabel(`正在生成「${moduleTitle}」的速背内容...`);
    try {
      const result = await runMemorize({
        ...getAuthPayload(),
        project: toProjectPayload(activeProject!),
        materials: scopedMaterials.map(({ id, title, kind, content }) => ({ id, title, kind, content })),
        extra: [
          `当前知识点：${moduleTitle}`,
          `考察内容：${module.exam_points || module.note || "请根据资料判断。"}`
        ].join("\n")
      });
      await storage.saveTask({
        ...module,
        memorization: stripMarkdown(result.content),
        updated_at: nowIso()
      });
      setMemorizeModuleId(module.id);
      setStatus("速背内容已生成。");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "速背内容生成失败。");
    } finally {
      setBusyLabel("");
    }
  }

  async function renameMock(mockId: string, newTitle: string) {
    const mock = scopedMocks.find((m) => m.id === mockId);
    if (!mock || !newTitle.trim()) return;
    await storage.saveMockAttempt({ ...mock, title: newTitle.trim() });
    await refresh();
  }

  function openMockForTaking(mock: MockAttempt, note: AiNote) {
    setActiveMockAttempt(mock);
    setResultNote(note);
    setMockUserAnswers({});
    setMockScoringResult(mock.feedback || null);
    if (mock.feedback) {
      const parsed = parseMockQuestions(note.content);
      const verdicts = gradePerQuestion(mock.feedback, parsed.questions.length);
      setSelectedMockMistakes(verdicts.reduce<number[]>((acc, v, i) => (v === "wrong" || v === "partial") ? [...acc, i] : acc, []));
    } else {
      setSelectedMockMistakes([]);
    }
    setMockExamState(mock.feedback ? "scored" : "taking");
  }

  function openMockRecord(mock: MockAttempt, note?: AiNote) {
    if (!note) {
      setStatus("找不到这份模拟考的试卷内容。");
      return;
    }
    if (mock.test_mode === "answer") {
      openMockForTaking(mock, note);
      return;
    }
    setActiveMockAttempt(mock);
    setResultNote(note);
    setMockUserAnswers({});
    setMockScoringResult(null);
    setSelectedMockMistakes([]);
    setMockExamState("scored");
  }

  async function submitMockAnswers() {
    if (!requireProject() || !requireAi()) return;
    if (!activeMockAttempt?.source_note_id) return setStatus("先选择一份模拟考。");
    const mockNote = scopedNotes.find((note) => note.id === activeMockAttempt.source_note_id);
    if (!mockNote) return setStatus("找不到这份模拟考的试卷内容。");
    const parsed = parseMockQuestions(mockNote.content);
    if (!parsed.questions.length) return setStatus("这份模拟考没拆出题目，先用答案速览模式查看。");
    const answeredCount = parsed.questions.filter((_, index) => (mockUserAnswers[String(index)] || "").trim()).length;
    if (!answeredCount) return setStatus("至少先写一道题的答案，再提交批改。");
    const userAnswers = parsed.questions
      .map((q, index) => {
        const answer = (mockUserAnswers[String(index)] || "").trim() || "未作答";
        if (q.type === "choice") {
          return `${q.question}\n选择：${answer}`;
        }
        return `${q.question}\n作答：${answer}`;
      })
      .join("\n\n");
    setBusyLabel("AI 正在批改模拟考...");
    try {
      const result = await gradeMock({
        ...getAuthPayload(),
        project: toProjectPayload(activeProject!),
        materials: scopedMaterials.map(({ id, title, kind, content }) => ({ id, title, kind, content })),
        exam_content: mockNote.content,
        user_answers: userAnswers
      });
      const feedback = stripMarkdown(result.content);
      const score = feedback.match(/【总分】\s*([^\n]+)/)?.[1]?.trim() || "";
      const updatedMock = { ...activeMockAttempt, score, feedback };
      await storage.saveMockAttempt(updatedMock);
      setActiveMockAttempt(updatedMock);
      setMockScoringResult(feedback);
      const verdicts = gradePerQuestion(feedback, parsed.questions.length);
      setSelectedMockMistakes(verdicts.reduce<number[]>((acc, v, i) => (v === "wrong" || v === "partial") ? [...acc, i] : acc, []));
      setMockExamState("scored");
      setStatus("批改完成。错题可以勾选后放进查漏补缺。");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "模拟考批改失败。");
    } finally {
      setBusyLabel("");
    }
  }

  async function saveSelectedMockMistakes() {
    if (!requireProject()) return;
    if (!selectedMockMistakes.length) return setStatus("先勾选要放进错题本的题。");
    const timestamp = nowIso();
    const userAnswerMap: Record<string, string> = {};
    if (activeMockPaper.questions.length) {
      activeMockPaper.questions.forEach((q, i) => {
        userAnswerMap[String(i)] = (mockUserAnswers[String(i)] || "").trim();
      });
    }
    await Promise.all(selectedMockMistakes.map((idx) => {
      const q = activeMockPaper.questions[idx];
      const userAnswer = userAnswerMap[String(idx)] || "未作答";
      const verdictText = mockQuestionVerdicts[idx] === "wrong" ? "批改结果：错误" :
        mockQuestionVerdicts[idx] === "partial" ? "批改结果：部分正确" : "";
      return storage.saveMistake({
        id: createId("mistake"),
        project_id: activeProject!.id,
        question: q.question,
        reason: [verdictText, `你的答案：${userAnswer}`].filter(Boolean).join("；"),
        fix: "按参考答案和批改意见复盘。",
        status: "new",
        source_note_id: activeMockAttempt?.source_note_id,
        created_at: timestamp,
        updated_at: timestamp
      });
    }));
    setSelectedMockMistakes([]);
    setStatus("已放进查漏补缺的错题本。");
    await refresh();
  }

  async function saveMistake(event: FormEvent) {
    event.preventDefault();
    if (!requireProject()) return;
    if (!mistakeDraft.question.trim()) return setStatus("错题内容要填一下。");
    const timestamp = nowIso();
    await storage.saveMistake({
      id: createId("mistake"),
      project_id: activeProject!.id,
      question: mistakeDraft.question.trim(),
      reason: mistakeDraft.reason.trim() || "还没写错因，复盘时补。",
      fix: mistakeDraft.fix.trim() || "还没写正确思路，复盘时补。",
      status: "new",
      created_at: timestamp,
      updated_at: timestamp
    });
    setMistakeDraft(emptyMistake);
    setStatus("错题已保存。");
    await refresh();
  }

  async function saveWeakPoint(event: FormEvent) {
    event.preventDefault();
    if (!requireProject()) return;
    if (!weakPointDraft.title.trim()) return setStatus("薄弱项名称要填一下。");
    const timestamp = nowIso();
    await storage.saveWeakPoint({
      id: createId("weak"),
      project_id: activeProject!.id,
      title: weakPointDraft.title.trim(),
      evidence: weakPointDraft.evidence.trim() || "手动标记",
      severity: weakPointDraft.severity,
      created_at: timestamp,
      updated_at: timestamp
    });
    setWeakPointDraft(emptyWeakPoint);
    setStatus("薄弱项已记录。");
    await refresh();
  }

  const apiPanel = (
    <form className="panel api-panel" onSubmit={saveApi}>
      <div className="panel-heading">
        <span className="heading-icon"><ShieldCheck size={20} weight="duotone" /></span>
        <div>
          <h2>连接 AI</h2>
          <p>可以先用内测邀请码，也可以切到自己的 API Key。</p>
        </div>
      </div>
      <div className="plan-mode-toggle">
        <button
          type="button"
          className={inviteState.aiMode === "invite" ? "tab active" : "tab"}
          onClick={() => saveInviteState({ ...inviteState, aiMode: "invite" })}
        >
          <Ticket size={16} weight="duotone" />邀请码
        </button>
        <button
          type="button"
          className={inviteState.aiMode === "custom" ? "tab active" : "tab"}
          onClick={() => saveInviteState({ ...inviteState, aiMode: "custom" })}
        >
          <Key size={16} weight="duotone" />自带 Key
        </button>
      </div>
      {inviteState.aiMode === "invite" ? (
        <>
          <label>邀请码<input value={inviteState.inviteCode} onChange={(event) => saveInviteState(updateInviteCodeDraft(inviteState, event.target.value))} placeholder="输入管理员给你的邀请码" /></label>
          <p className="hint">
            {inviteState.validatedAt
              ? inviteState.remaining === -1
                ? "无限额，永不过期。"
                : `邀请码有效，剩余 ${inviteState.remaining} 次，预算 ¥${inviteState.remainingBudgetCny}。`
              : "输入邀请码后先验证一次；后续生成计划、讲解、卡片都会自动带上它。"}
          </p>
          <div className="actions">
            <button type="button" onClick={verifyInvite} disabled={busy}><ShieldCheck size={18} weight="bold" />验证邀请码</button>
          </div>
        </>
      ) : (
        <>
          <label>
            平台
            <select value={apiConfig.provider_name} onChange={(event) => updatePreset(event.target.value)}>
              {presets.map((preset) => <option key={preset.provider_name}>{preset.provider_name}</option>)}
            </select>
          </label>
          <label>API Key<input type="password" value={apiConfig.api_key} onChange={(event) => setApiConfig({ ...apiConfig, api_key: event.target.value })} placeholder="粘贴自己的 API Key" /></label>
          <p className="hint">DeepSeek 的 Key 可以去开放平台创建。复制后粘到这里就好，KaoBuddy 只存在当前浏览器里，请求 AI 时临时转发，不写数据库。</p>
          <button type="button" className="text-button" onClick={() => setShowAdvancedApi((value) => !value)}>
            {showAdvancedApi ? "收起高级设置" : "高级设置"}
          </button>
          {showAdvancedApi && (
            <div className="advanced">
              <label>Base URL<input value={apiConfig.base_url} onChange={(event) => setApiConfig({ ...apiConfig, base_url: event.target.value })} /></label>
              <label>Model<input value={apiConfig.model} onChange={(event) => setApiConfig({ ...apiConfig, model: event.target.value })} /></label>
            </div>
          )}
          <div className="actions">
            <button type="submit"><GearSix size={18} weight="bold" />保存配置</button>
            <button type="button" className="secondary" onClick={testApi} disabled={busy}><Lightning size={18} weight="bold" />测试连接</button>
          </div>
        </>
      )}
    </form>
  );

  const projectForm = (
    <form className="panel project-form" onSubmit={createProject}>
      <div className="panel-heading">
        <span className="heading-icon"><Target size={20} weight="duotone" /></span>
        <div>
          <h2>{editingProjectId ? "编辑项目信息" : projects.length ? "新建项目" : "创建第一个项目"}</h2>
          <p>先把考试定下来，后面的计划才不会乱跑。</p>
        </div>
      </div>
      <label>科目<input value={projectDraft.subject} onChange={(event) => setProjectDraft({ ...projectDraft, subject: event.target.value })} placeholder="比如 高数 / 法考 / 期末英语" /></label>
      <label>考试日期<input type="date" value={projectDraft.exam_date} onChange={(event) => setProjectDraft({ ...projectDraft, exam_date: event.target.value })} /></label>
      <label>目标分数<input value={projectDraft.target_score} onChange={(event) => setProjectDraft({ ...projectDraft, target_score: event.target.value })} placeholder="可不填" /></label>
      <label>薄弱项<textarea value={projectDraft.weak_points} onChange={(event) => setProjectDraft({ ...projectDraft, weak_points: event.target.value })} placeholder="可不填，后面可以让 AI 推断" /></label>
      <div className="actions wrap">
        <button type="submit"><CheckCircle size={18} weight="bold" />{editingProjectId ? "保存修改" : projects.length ? "保存项目" : "进入考搭子"}</button>
        {editingProjectId && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setEditingProjectId("");
              setProjectDraft(emptyProject);
              setShowNewProject(false);
            }}
          >
            <ArrowLeft size={18} weight="bold" />取消
          </button>
        )}
      </div>
    </form>
  );

  const setupIndex = setupSteps.findIndex((item) => item.step === setupStep);

  if (!projects.length || showSetup) {
    return (
      <motion.main className="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.24 }}>
        <StatusToast className={statusClass} message={statusMessage} onCancel={cancelGeneration} />
        <section className="home-hero app-section">
          <div className="hero-copy">
            <BrandMark />
            <p className="eyebrow">本地备考工作台</p>
            <h1>临时抱佛脚，也要有章法。</h1>
            <div className="hero-actions">
              {!!projects.length && (
                <button
                  type="button"
                  onClick={() => {
                    setShowSetup(false);
                    setStatus("已回到项目工作区。");
                  }}
                >
                  <ArrowLeft size={20} weight="bold" />回到工作台
                </button>
              )}
            </div>
          </div>
          <div className="hero-command" aria-label="KaoBuddy 使用流程">
            <div className="command-topline">
              <span>考前闭环</span>
              <strong>资料进来，计划出去</strong>
            </div>
            <div className="command-list">
              <span><FileArrowUp size={18} weight="duotone" />导入课件、教材、往年题、笔记、视频字幕</span>
              <span><Brain size={18} weight="duotone" />拆成能学的知识模块，并生成学习卡片</span>
              <span><ClipboardText size={18} weight="duotone" />刷题、模考、查漏</span>
              <span><Cards size={18} weight="duotone" />临考前一个个斩掉</span>
            </div>
          </div>
        </section>

        <section className="setup-shell app-section">
          <nav className="setup-steps" aria-label="初始化进度">
            {setupSteps.map((item, index) => {
              const StepIcon = setupIcons[item.step];
              return (
                <button
                  key={item.step}
                  className={index === setupIndex ? "active" : index < setupIndex ? "done" : ""}
                  onClick={() => setSetupStep(item.step)}
                  type="button"
                >
                  <span><StepIcon size={18} weight="duotone" /></span>
                  {item.label}
                </button>
              );
            })}
          </nav>

          <AnimatePresence mode="wait">
            {setupStep === "intro" && (
              <motion.div key="intro" className="panel setup-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                <div className="panel-heading">
                  <span className="heading-icon"><Sparkle size={20} weight="duotone" /></span>
                  <div>
                    <h2>考搭子能做什么</h2>
                    <p>先把散乱资料收起来，再变成清晰的复习路线。</p>
                  </div>
                </div>
                <p>考搭子是一个本地备考助手。你只需要把课件、教材、笔记、手写资料或视频字幕放进来，它会自动整理资料、抽取知识点，并按重要程度生成学习模块。</p>
                <p>资料越完整，预测越精准。考搭子会根据你导入的内容判断哪些知识点更可能考、哪些需要优先学，帮你把散乱资料变成清晰的复习路线。</p>
                <p>不用再手动翻课件、抄重点、列计划。内测期间可以使用邀请码体验；额度用完后，也可以切换到自己的 API Key 继续使用。</p>
                <div className="actions">
                  <button type="button" onClick={goSetupNext}><ListChecks size={18} weight="bold" />下一步：看使用流程</button>
                </div>
              </motion.div>
            )}

            {setupStep === "flow" && (
              <motion.div key="flow" className="panel setup-panel intro-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                <div className="panel-heading">
                  <span className="heading-icon"><ListChecks size={20} weight="duotone" /></span>
                  <div>
                    <h2>使用流程</h2>
                    <p>按这个顺序走，先把 AI 连接好，再让资料变成模块、日计划和学习卡片。</p>
                  </div>
                </div>
                <ol>
                  <li>先用邀请码或自己的 API Key 连接 AI。</li>
                  <li>创建一个考试项目，比如操作系统、高数、法考。</li>
                  <li>导入课件、教材、往年题、笔记、手写资料或视频字幕。</li>
                  <li>生成知识模块计划，再拆成学习卡片和模块任务。</li>
                  <li>用日计划安排每天要学的模块，按优先级推进今日任务。</li>
                  <li>学模块、翻卡片、做模块题，最后用模拟考和临考速背查漏补缺。</li>
                </ol>
                <div className="actions">
                  <button type="button" className="secondary" onClick={goSetupBack}><ArrowLeft size={18} weight="bold" />上一步</button>
                  <button type="button" onClick={goSetupNext}><ShieldCheck size={18} weight="bold" />下一步：连接 AI</button>
                </div>
              </motion.div>
            )}

            {setupStep === "api" && (
              <motion.div key="api" className="setup-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                {apiPanel}
                <div className="actions setup-actions">
                  <button type="button" className="secondary" onClick={goSetupBack}><ArrowLeft size={18} weight="bold" />上一步</button>
                  <button type="button" onClick={goSetupNext}><Target size={18} weight="bold" />下一步：创建项目</button>
                </div>
              </motion.div>
            )}

            {setupStep === "project" && (
              <motion.div key="project" className="setup-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                {projectForm}
                <div className="actions setup-actions">
                  <button type="button" className="secondary" onClick={goSetupBack}><ArrowLeft size={18} weight="bold" />上一步</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </motion.main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark compact />
        </div>
        <button
          className="secondary"
          onClick={() => {
            setEditingProjectId("");
            setProjectDraft(emptyProject);
            setShowNewProject((value) => !value);
          }}
        >
          <PlusCircle size={18} weight="bold" />{showNewProject && !editingProjectId ? "收起新建" : "新建项目"}
        </button>
        <button
          className="secondary"
          onClick={() => {
            setShowSetup(true);
            setSetupStep("intro");
            setShowNewProject(false);
            setStatus("已打开初始化页面，可以回看流程或调整 API。");
          }}
        >
          <Sparkle size={18} weight="bold" />初始化页面
        </button>
        {showNewProject && <div className="sidebar-form">{projectForm}</div>}
        <div className="project-list">
          {projects.map((project) => (
            <article
              key={project.id}
              className={project.id === activeProject?.id ? "project-card active" : "project-card"}
            >
              <button
                className="project-open"
                onClick={() => {
                  setActiveProjectId(project.id);
                  setActiveTab("overview");
                  setResultNote(null);
                  setSelectedModuleId("");
                }}
              >
                <span>{project.subject}</span>
                <small>倒计时 {daysLeft(project.exam_date)} 天 · {projectProgress(project.id)}%</small>
              </button>
              <div className="project-actions">
                <button className="mini secondary" onClick={() => editProject(project)}><PencilSimple size={15} weight="bold" />编辑</button>
                <button className="mini danger" onClick={() => deleteProject(project)}><Trash size={15} weight="bold" />删除</button>
              </div>
            </article>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-head app-section">
          <div>
            <p className="eyebrow">当前项目</p>
            <h1>{activeProject?.subject || "考搭子"}</h1>
            <p>{activeProject ? `考试日期 ${activeProject.exam_date} · 目标 ${activeProject.target_score || "未填写"}` : "从左侧选择一个项目。"}</p>
          </div>
          <div className="progress-card">
            <span>整体完成进度</span>
            <div className="progress-ring" style={{ "--progress": `${Math.min(progress, 100)}%` } as CSSProperties}>
              <strong>{progress}%</strong>
            </div>
            <small>{completedModules} / {visibleModules.length} 个模块已学习</small>
          </div>
        </header>

        <StatusToast className={statusClass} message={statusMessage} onCancel={cancelGeneration} />

        <nav className="tabs">
          {visibleTabs.map(({ tab, label }) => {
            const TabIcon = tabIcons[tab];
            return (
              <button key={tab} className={activeTab === tab ? "tab active" : "tab"} onClick={() => setActiveTab(tab)}>
                <TabIcon size={18} weight="duotone" />
                {label}
              </button>
            );
          })}
        </nav>

        {activeTab === "overview" && (
          <section className="page-grid app-section">
            <div className="panel metric-panel">
              <span><ClockCountdown size={18} weight="duotone" />考试倒计时</span>
              <strong>{activeProject ? daysLeft(activeProject.exam_date) : "-"} 天</strong>
              <small>每天不用完美，模块能滚动推进就行。</small>
            </div>
            <div className="panel metric-panel">
              <span><BookOpen size={18} weight="duotone" />知识模块</span>
              <strong>{completedModules} / {visibleModules.length}</strong>
              <small>学习进度按已学习模块数量计算。</small>
            </div>
            <div className="panel metric-panel">
              <span><Target size={18} weight="duotone" />当前重点</span>
              <strong className="focus-text">{currentFocusModule ? displayModuleTitle(currentFocusModule.title, currentFocusModule.note) : "暂无"}</strong>
              <small>去计划页拖动顺序或标记完成。</small>
            </div>
            <div
              className="panel metric-panel"
              style={scopedMocks[0] ? { cursor: "pointer" } : undefined}
              onClick={() => {
                const latest = scopedMocks[0];
                if (!latest) return;
                const note = scopedNotes.find((n) => n.id === latest.source_note_id);
                setActiveTab("mock");
                openMockRecord(latest, note);
              }}
            >
              <span><Timer size={18} weight="duotone" />最近模考</span>
              <strong>{scopedMocks[0]?.title || "暂无"}</strong>
              <small>{scopedMocks[0] ? `${scopedMocks[0].duration_minutes} 分钟 · 点击查看` : "模拟考页可以生成模考。"}</small>
            </div>
            {todayModules.length > 0 && (
              <div className="panel wide today-panel">
                <div className="today-panel-head">
                  <span><ClockCountdown size={18} weight="duotone" />今日任务</span>
                  <small>{todayModules.length} 个模块 · 预计 {todayModules.reduce((s, m) => s + m.estimated_minutes, 0)} 分钟</small>
                </div>
                <div className="today-list">
                  {todayModules.map((item) => (
                    <article
                      key={item.id}
                      className="today-row"
                      onClick={() => openModule(item)}
                    >
                      <div className="today-row-main">
                        <strong>{displayModuleTitle(item.title, item.note)}</strong>
                        <div className="today-row-meta">
                          <span>{difficultyLabel(item.difficulty)}</span>
                          <span>{moduleImportanceLabel(item, visibleModules)}</span>
                        </div>
                      </div>
                      <span className={`module-status-dot ${moduleStatus(item)}`} />
                    </article>
                  ))}
                </div>
              </div>
            )}
            {scopedMaterials.length === 0 && (
              <div className="panel wide next-step-panel">
                <div>
                  <span className="kind-badge">下一步</span>
                  <h2>先把资料放进来</h2>
                  <p>先导入课件、教材、往年题、手写笔记或视频字幕，考搭子才有东西可拆。</p>
                </div>
                <button onClick={() => setActiveTab("materials")}>
                  <Lightning size={18} weight="bold" />去导入资料
                </button>
              </div>
            )}
          </section>
        )}

        {activeTab === "materials" && (
          <section className="grid two app-section">
            <div className="panel">
              <div className="panel-heading">
                <span className="heading-icon"><UploadSimple size={20} weight="duotone" /></span>
                <div>
                  <h2>资料导入</h2>
                  <p>先快速收进资料库，扫描页和复杂图表后面再慢慢补。</p>
                </div>
              </div>
              <label className="file primary-upload"><UploadSimple size={20} weight="bold" />批量上传课件 / 教材 / 往年题（PDF / PPTX / DOC / DOCX）<input type="file" accept=".pdf,.ppt,.pptx,.doc,.docx,.odt,.rtf,.txt,.md,.markdown,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" multiple onChange={(event) => handleFiles(event.target.files)} /></label>
              <p className="hint">默认会快速读取 PDF 文字层，先把资料放进库里。扫描页、图表和公式这类慢识别，后面单独处理，避免上传时卡太久。</p>
              {!!uploadQueue.length && (
                <div className="upload-queue">
                  {uploadQueue.map((item) => (
                    <div key={item.id} className={`upload-row ${item.state}`}>
                      <strong>{item.name}</strong>
                      <span>{item.message}</span>
                    </div>
                  ))}
                </div>
              )}
              <label>手写笔记说明<input value={handwritingHint} onChange={(event) => setHandwritingHint(event.target.value)} placeholder="比如 第三章极限笔记" /></label>
              <label className="file"><Notebook size={18} weight="bold" />上传手写图片/PDF<input type="file" accept="image/*,.pdf" multiple onChange={(event) => handleHandwriting(event.target.files)} /></label>
              <label>B站等视频链接<input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://www.bilibili.com/video/..." /></label>
              <button onClick={handleVideoImport} disabled={!activeProject || busy}><Video size={18} weight="bold" />导入视频字幕</button>
            </div>
            <div className="panel material-library">
              <div className="panel-heading">
                <span className="heading-icon"><BookOpen size={20} weight="duotone" /></span>
                <div>
                  <h2>资料库</h2>
                  <p>{scopedMaterials.length ? `已经收进 ${scopedMaterials.length} 份资料。` : "还没有资料，先把课件扔进来。"}</p>
                </div>
              </div>
              <div className="list material-list">
                {scopedMaterials.map((item) => (
                  <article key={item.id} className="item material-row">
                    <div className="item-head">
                      <strong>{item.title}</strong>
                      <button className="mini danger" onClick={() => deleteMaterial(item)}><Trash size={15} weight="bold" />删除</button>
                    </div>
                  </article>
                ))}
                {!scopedMaterials.length && <p className="muted">还没有资料。</p>}
              </div>
            </div>
          </section>
        )}

        {activeTab === "plan" && (
          <section className="app-section">
            <div className="panel plan-actions">
              <div className="panel-heading">
                <span className="heading-icon"><Kanban size={20} weight="duotone" /></span>
                <div>
                  <h2>{planMode === "modules" ? "生成知识模块计划" : "日计划"}</h2>
                  <p>{planMode === "modules" ? "把资料拆成能拖、能学、能斩的知识点卡片。" : "把知识点按剩余天数排到每天，每天聚焦几个模块。"}</p>
                </div>
              </div>
              <div className="plan-mode-toggle">
                <button className={planMode === "modules" ? "tab active" : "tab"} onClick={() => setPlanMode("modules")}><Kanban size={16} weight="duotone" />知识点模式</button>
                <button className={planMode === "daily" ? "tab active" : "tab"} onClick={() => setPlanMode("daily")}><ClockCountdown size={16} weight="duotone" />日计划模式</button>
              </div>
              {planMode === "modules" ? (
                <>
                  <label>补充要求<textarea value={extra} onChange={(event) => setExtra(event.target.value)} placeholder="比如 只剩三天，先救选择题相关模块。" /></label>
                  <div className="actions wrap">
                    <button onClick={() => runMode("plan", "知识模块计划")} disabled={busy}><StackPlus size={18} weight="bold" />{visibleModules.length ? "重新生成计划" : "生成计划"}</button>
                    {latestPlanNote && (
                      <button className="secondary" onClick={() => { setResultNote(latestPlanNote); setActiveTab("result"); }}>
                        <Sparkle size={18} weight="bold" />查看计划结果
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {overdueModules.length > 0 && (
                    <div className="overdue-banner">
                      <span><ClockCountdown size={16} weight="duotone" />{overdueModules.length} 个模块已逾期</span>
                      <button className="mini" onClick={rescheduleOverdue}>全部挪到今天</button>
                    </div>
                  )}
                  <label>补充要求<textarea value={extra} onChange={(event) => setExtra(event.target.value)} placeholder="比如 每天不超过 90 分钟，先安排重要程度高的模块。" /></label>
                  <div className="actions wrap">
                    <button onClick={generateDailyPlan} disabled={busy}><ClockCountdown size={18} weight="bold" />生成每日计划</button>
                  </div>
                </>
              )}
            </div>

            {planMode === "modules" ? (
              <>
                <div className="kanban">
                  {moduleColumns.map((column) => {
                    const columnModules = visibleModules.filter((item) => moduleStatus(item) === column.status);
                    return (
                      <div key={column.status} className="kanban-column" onDragOver={(event) => event.preventDefault()} onDrop={() => moveModule(column.status)}>
                        <div className="column-head">
                          <strong>{column.title}</strong>
                          <small>{column.hint}</small>
                        </div>
                        {columnModules.map((item) => (
                          <article key={item.id} className="module-card" draggable onDragStart={() => setDraggingModuleId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); moveModule(column.status, item.id); }} onClick={() => openModule(item)}>
                            <strong>{displayModuleTitle(item.title, item.note)}</strong>
                            <div className="module-meta"><span>{difficultyLabel(item.difficulty)}</span></div>
                            {moduleStatus(item) !== "done" && <button className="mini" onClick={(event) => { event.stopPropagation(); learningButtonAction(item) === "open" ? openModule(item) : startModule(item); }}><Lightning size={15} weight="bold" />点击学习</button>}
                          </article>
                        ))}
                        {!columnModules.length && <span className="empty-slot">拖到这里</span>}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="daily-plan-list">
                {hasDailyPlan ? dailyPlanGroups.map((group) => {
                  const isToday = group.date === todayKey;
                  const isOverdue = group.date < todayKey;
                  return (
                    <div key={group.date} className={`daily-group${isToday ? " today" : ""}${isOverdue ? " overdue" : ""}`}>
                      <div className="daily-group-head">
                        <strong>{dateLabel(group.date)}</strong>
                        <small>
                          {group.items.length} 个模块 ·
                          高 {group.importanceCounts.high} / 中 {group.importanceCounts.medium} / 低 {group.importanceCounts.low}
                        </small>
                      </div>
                      <div className="daily-group-items">
                        {group.items.length ? group.items.map((item) => (
                          <article key={item.id} className="daily-item" onClick={() => openModule(item)}>
                            <div className="daily-item-main">
                              <strong>{displayModuleTitle(item.title, item.note)}</strong>
                              <div className="daily-item-meta">
                                <span>{difficultyLabel(item.difficulty)}</span>
                                <span>{moduleImportanceLabel(item, visibleModules)}</span>
                              </div>
                            </div>
                            <span className={`module-status-dot ${moduleStatus(item)}`} />
                          </article>
                        )) : (
                          <div className="daily-day-empty">
                            <span>{isOverdue ? "昨天没有留下未完成模块。" : "这天还没有安排模块。"}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }) : (
                  <div className="panel">
                    <p className="muted">还没有日计划。点击上方「生成每日计划」，AI 会自动按剩余天数分配模块。</p>
                  </div>
                )}
              </div>
            )}

          </section>
        )}

        {activeTab === "mock" && (
          <section className="app-section">
            {!(activeMockAttempt && mockExamState !== "list") && (<div className="grid two">
              <div className="panel">
                <div className="panel-heading">
                  <span className="heading-icon"><ClipboardText size={20} weight="duotone" /></span>
                  <div>
                    <h2>模拟考</h2>
                    <p>{mockMode === "text" ? "生成完整文字版，题目和参考答案一起看。" : "想快速过题就看答案速览；想检验掌握情况，就AI答题，提交后由 AI 批改。"}</p>
                  </div>
                </div>
                <div className="plan-mode-toggle">
                  <button className={mockMode === "text" ? "tab active" : "tab"} onClick={() => setMockMode("text")}><Notebook size={16} weight="duotone" />答案速览</button>
                  <button className={mockMode === "answer" ? "tab active" : "tab"} onClick={() => setMockMode("answer")}><PencilSimple size={16} weight="duotone" />AI答题</button>
                </div>
                <label>考试时长（分钟）
                  <input type="number" min={5} max={180} value={mockDuration || ""} placeholder="输入分钟数，如 30" onChange={(event) => setMockDuration(Number(event.target.value))} />
                </label>
                <label>想生成什么题型<textarea value={mockQuestionTypes} onChange={(event) => setMockQuestionTypes(event.target.value)} placeholder="比如 选择题、简答题、计算题；不填就让 AI 自己安排。" /></label>
                <label>补充要求<textarea value={extra} onChange={(event) => setExtra(event.target.value)} placeholder="比如 题量少一点，重点考进程和文件管理。" /></label>
                <div className="actions wrap">
                  <button
                    onClick={() => {
                      if (!mockDuration || mockDuration < 5) return setStatus("先填考试时长（至少 5 分钟）。");
                      const requestedDuration = normalizeMockDuration(mockDuration);
                      runMode(
                        "mock-exam",
                        "模拟考",
                        [
                          `考试时长：${requestedDuration} 分钟`,
                          mockQuestionTypes.trim() ? `题型要求：${mockQuestionTypes.trim()}` : "",
                          mockMode === "answer" ? "生成AI答题模式：题目和题目解析仍按规定输出，但前端会先隐藏解析。" : "",
                          extra.trim()
                        ].filter(Boolean).join("；"),
                        requestedDuration
                      );
                    }}
                    disabled={busy}
                  >
                    <Timer size={18} weight="bold" />生成模拟考
                  </button>
                </div>
              </div>
              <div className="panel">
                <div className="panel-heading">
                  <span className="heading-icon"><Notebook size={20} weight="duotone" /></span>
                  <div>
                    <h2>已生成的模拟考</h2>
                    <p>{scopedMocks.length ? "点标题可以重命名，点记录可以查看或继续作答。" : "生成后这里会自动留下记录。"}</p>
                  </div>
                </div>
                <div className="list compact">
                  {scopedMocks.map((item) => {
                    const mockNote = scopedNotes.find((note) => note.id === item.source_note_id);
                    const isEditing = editingMockId === item.id;
                    const isSelected = activeMockAttempt?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`item mock-record ${isSelected ? "selected" : ""}`}
                        role="button"
                        tabIndex={isEditing ? -1 : 0}
                        aria-pressed={isSelected}
                        onClick={() => {
                          if (isEditing) return;
                          openMockRecord(item, mockNote);
                        }}
                        onKeyDown={(event) => {
                          if (isEditing) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openMockRecord(item, mockNote);
                          }
                        }}
                      >
                        <div className="mock-record-head">
                          {isEditing ? (
                            <input
                              className="mock-rename-input"
                              defaultValue={item.title}
                              autoFocus
                              onBlur={(event) => {
                                renameMock(item.id, event.target.value);
                                setEditingMockId("");
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  renameMock(item.id, event.currentTarget.value);
                                  setEditingMockId("");
                                }
                                if (event.key === "Escape") setEditingMockId("");
                              }}
                            />
                          ) : (
                            <strong
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingMockId(item.id);
                              }}
                              title="点击重命名"
                            >
                              {item.title}
                            </strong>
                          )}
                        </div>
                        <div className="mock-record-body">
                          <small>
                            <span className={`kind-badge ${item.test_mode === "answer" ? "" : "muted"}`}>{item.test_mode === "answer" ? "AI答题" : "答案速览"}</span>
                            {" "}{item.duration_minutes} 分钟 · {new Date(item.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            {item.score ? ` · ${item.score}` : ""}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                  {!scopedMocks.length && <p className="muted">生成模拟考后，这里会自动留下记录。</p>}
                </div>
              </div>
            </div>)}

            {activeMockAttempt && mockExamState !== "list" && activeMockNote && (
              <div className="panel mock-taking">
                {(() => {
                  const isAnswerPreview = mockExamState === "scored" && !mockScoringResult && !activeMockAttempt.feedback;
                  return (
                    <>
                <div className="result-head">
                  <div>
                    <span className="kind-badge">{mockExamState === "scored" ? (mockScoringResult ? "已批改" : "答案速览") : "答题中"}</span>
                    <h2>{activeMockAttempt.title}</h2>
                    <p className="muted">{mockExamState === "scored" ? (mockScoringResult ? "下面是批改结果和参考解析，可以把错题放进查漏补缺。" : "题目和参考答案一起看，快速过一遍。") : "参考答案先藏起来，写完后交给 AI 批改。"}</p>
                  </div>
                  <div className="actions wrap">
                    <button onClick={async () => {
                      setBusyLabel("正在生成 PDF...");
                      try {
                        await exportMockExamPdf(activeMockNote.content, activeMockAttempt.title);
                        setStatus("PDF 已下载。");
                      } catch (error) {
                        setStatus(error instanceof Error ? error.message : "PDF 生成失败。");
                      } finally {
                        setBusyLabel("");
                      }
                    }} disabled={busy}><DownloadSimple size={18} weight="bold" />下载 PDF</button>
                    <button className="secondary" onClick={() => {
                      setActiveMockAttempt(null);
                      setMockExamState("list");
                      setMockScoringResult(null);
                      setSelectedMockMistakes([]);
                    }}><ArrowLeft size={18} weight="bold" />收起</button>
                  </div>
                </div>

                {isAnswerPreview ? (
                  <div className="mock-preview-grid">
                    <div className="mock-preview-section">
                      <h3>试题速览</h3>
                      {activeMockPaper.questions.length ? activeMockPaper.questions.map((q, index) => (
                        <article key={`${activeMockAttempt.id}-preview-${index}`} className="mock-preview-question">
                          <strong>{q.question}</strong>
                          {q.options?.length ? (
                            <div className="mock-preview-options">
                              {q.options.map((opt) => <span key={opt}>{opt}</span>)}
                            </div>
                          ) : null}
                        </article>
                      )) : (
                        <RenderHumanText text={activeMockNote.content} />
                      )}
                    </div>
                    {activeMockPaper.answerKey && (
                      <div className="mock-answer-key">
                        <h3>参考答案与解析</h3>
                        <RenderHumanText text={activeMockPaper.answerKey} />
                      </div>
                    )}
                  </div>
                ) : activeMockPaper.questions.length ? activeMockPaper.questions.map((q, index) => (
                  <div className="mock-question-block" key={`${activeMockAttempt.id}-${index}`}>
                    <strong>{q.question}</strong>
                    {q.type === "choice" && q.options ? (
                      <div className="mock-choices">
                        {q.options.map((opt) => {
                          const letter = opt.match(/^([A-Ea-e])[.．、]/)?.[1]?.toUpperCase() || opt[0];
                          const isSelected = (mockUserAnswers[String(index)] || "").toUpperCase() === letter;
                          return (
                            <label
                              key={opt}
                              className={`mock-choice-option${isSelected ? " selected" : ""}${mockExamState === "scored" ? " disabled" : ""}`}
                            >
                              <input
                                type="radio"
                                name={`q-${activeMockAttempt.id}-${index}`}
                                value={letter}
                                checked={isSelected}
                                disabled={mockExamState === "scored"}
                                onChange={() => setMockUserAnswers({ ...mockUserAnswers, [String(index)]: letter })}
                              />
                              <span>{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <textarea
                        value={mockUserAnswers[String(index)] || ""}
                        disabled={mockExamState === "scored"}
                        onChange={(event) => setMockUserAnswers({ ...mockUserAnswers, [String(index)]: event.target.value })}
                        placeholder="把你的答案写在这里。"
                      />
                    )}
                  </div>
                )) : (
                  <p className="muted">这份模拟考没有拆出题目，可以切回答案速览模式查看完整内容。</p>
                )}

                {mockExamState !== "scored" ? (
                  <div className="actions wrap">
                    <button onClick={submitMockAnswers} disabled={busy || !activeMockPaper.questions.length}><CheckCircle size={18} weight="bold" />提交并批改</button>
                  </div>
                ) : (
                  <>
                    {(mockScoringResult || activeMockAttempt.feedback) && (
                      <div className="mock-scoring-result">
                        <h3>AI 批改</h3>
                        <RenderHumanText text={mockScoringResult || activeMockAttempt.feedback || ""} />
                      </div>
                    )}
                    {!!mockMistakeCandidates.length && (
                      <div className="mock-mistake-picker">
                        <h3>选择要放进错题本的题</h3>
                        {mockMistakeCandidates.map((candidate) => (
                          <label key={candidate.index} className="mock-mistake-option">
                            <input
                              type="checkbox"
                              checked={selectedMockMistakes.includes(candidate.index)}
                              onChange={(event) => {
                                setSelectedMockMistakes(event.target.checked
                                  ? [...selectedMockMistakes, candidate.index]
                                  : selectedMockMistakes.filter((i) => i !== candidate.index));
                              }}
                            />
                            <span>
                              {candidate.verdict !== "unknown" && (
                                <span className={`kind-badge ${
                                  candidate.verdict === "wrong" ? "danger" :
                                  candidate.verdict === "partial" ? "warn" :
                                  candidate.verdict === "correct" ? "success" : ""
                                }`}>
                                  {candidate.verdict === "wrong" ? "错误" :
                                   candidate.verdict === "partial" ? "部分正确" : "全对"}
                                </span>
                              )}
                              {" "}{candidate.question.question}
                            </span>
                          </label>
                        ))}
                        <button onClick={saveSelectedMockMistakes} disabled={!selectedMockMistakes.length}><Notebook size={18} weight="bold" />放进查漏补缺</button>
                      </div>
                    )}
                    {activeMockPaper.answerKey && (
                      <div className="mock-answer-key">
                        <h3>参考答案与解析</h3>
                        <RenderHumanText text={activeMockPaper.answerKey} />
                      </div>
                    )}
                    <div className="actions wrap">
                      <button className="secondary" onClick={() => {
                        setActiveMockAttempt(null);
                        setMockExamState("list");
                        setMockScoringResult(null);
                        setSelectedMockMistakes([]);
                      }}><ArrowLeft size={18} weight="bold" />收起</button>
                    </div>
                  </>
                )}
                    </>
                  );
                })()}
              </div>
            )}
          </section>
        )}

        {activeTab === "gap" && (
          <section className="grid two app-section">
            <div className="panel">
              <div className="panel-heading">
                <span className="heading-icon"><Target size={20} weight="duotone" /></span>
                <div>
                  <h2>手动添加错题</h2>
                  <p>你可以自己手动添加其他的错题到自己的错题本中</p>
                </div>
              </div>
              <form className="mistake-form" onSubmit={saveMistake}>
                <label>错题内容<textarea value={mistakeDraft.question} onChange={(event) => setMistakeDraft({ ...mistakeDraft, question: event.target.value })} placeholder="粘贴题目，或写一句自己错在哪里。" /></label>
                <label>错因<textarea value={mistakeDraft.reason} onChange={(event) => setMistakeDraft({ ...mistakeDraft, reason: event.target.value })} placeholder="比如 概念混了、步骤漏了、公式记错。" /></label>
                <label>正确思路<textarea value={mistakeDraft.fix} onChange={(event) => setMistakeDraft({ ...mistakeDraft, fix: event.target.value })} placeholder="写下下次怎么做对。" /></label>
                <button type="submit"><Notebook size={18} weight="bold" />保存错题</button>
              </form>
            </div>

            <div className="panel">
              <div className="panel-heading">
                <span className="heading-icon"><Notebook size={20} weight="duotone" /></span>
                <div>
                  <h2>错题本</h2>
                  <p>{scopedMistakes.length ? `已经收进 ${scopedMistakes.length} 道错题。` : "还没有错题，模考批改后可以勾选加入。"}</p>
                </div>
              </div>
              <div className="plan-mode-toggle sub-nav">
                <button className={mistakeFilter === "all" ? "tab active" : "tab"} onClick={() => setMistakeFilter("all")}>全部</button>
                <button className={mistakeFilter === "new" ? "tab active" : "tab"} onClick={() => setMistakeFilter("new")}>未复盘</button>
                <button className={mistakeFilter === "reviewed" ? "tab active" : "tab"} onClick={() => setMistakeFilter("reviewed")}>已复盘</button>
              </div>
              <div className="list compact">
                {visibleMistakes.map((item) => {
                  const isExpanded = expandedMistakeId === item.id;
                  const isEditing = editingMistakeId === item.id;
                  return (
                    <article key={item.id} className="item mistake-row">
                      <div className="item-head" onClick={() => setExpandedMistakeId(isExpanded ? "" : item.id)}>
                        <strong>{item.question.slice(0, 70)}{item.question.length > 70 ? "..." : ""}</strong>
                        <span className={`kind-badge ${item.status === "reviewed" ? "success" : ""}`}>{item.status === "reviewed" ? "已复盘" : "未复盘"}</span>
                      </div>
                      {isExpanded && (
                        <div className="mistake-detail">
                          {isEditing ? (
                            <>
                              <label>错题内容<textarea value={mistakeDraft.question} onChange={(event) => setMistakeDraft({ ...mistakeDraft, question: event.target.value })} /></label>
                              <label>错因<textarea value={mistakeDraft.reason} onChange={(event) => setMistakeDraft({ ...mistakeDraft, reason: event.target.value })} /></label>
                              <label>正确思路<textarea value={mistakeDraft.fix} onChange={(event) => setMistakeDraft({ ...mistakeDraft, fix: event.target.value })} /></label>
                              <div className="actions wrap">
                                <button onClick={async () => {
                                  await storage.saveMistake({
                                    ...item,
                                    question: mistakeDraft.question.trim() || item.question,
                                    reason: mistakeDraft.reason.trim() || item.reason,
                                    fix: mistakeDraft.fix.trim() || item.fix,
                                    updated_at: nowIso()
                                  });
                                  setEditingMistakeId("");
                                  setMistakeDraft(emptyMistake);
                                  setStatus("错题已更新。");
                                  await refresh();
                                }}><CheckCircle size={18} weight="bold" />保存修改</button>
                                <button className="secondary" onClick={() => {
                                  setEditingMistakeId("");
                                  setMistakeDraft(emptyMistake);
                                }}><ArrowLeft size={18} weight="bold" />取消</button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div><strong>题目</strong><p>{item.question}</p></div>
                              <div><strong>错因</strong><p>{item.reason}</p></div>
                              <div><strong>正确思路</strong><p>{item.fix}</p></div>
                              <div className="actions wrap">
                                <button className="secondary" onClick={async () => {
                                  await storage.saveMistake({ ...item, status: item.status === "reviewed" ? "new" : "reviewed", updated_at: nowIso() });
                                  setStatus(item.status === "reviewed" ? "已重新标为未复盘。" : "已标记为复盘过。");
                                  await refresh();
                                }}><CheckCircle size={18} weight="bold" />{item.status === "reviewed" ? "重新复盘" : "标记已复盘"}</button>
                                <button className="secondary" onClick={() => {
                                  setEditingMistakeId(item.id);
                                  setMistakeDraft({ question: item.question, reason: item.reason, fix: item.fix });
                                }}><PencilSimple size={18} weight="bold" />编辑</button>
                                <button className="danger" onClick={async () => {
                                  await storage.deleteMistake(item.id);
                                  setStatus("错题已删除。");
                                  await refresh();
                                }}><Trash size={18} weight="bold" />删除</button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
                {!visibleMistakes.length && <p className="muted">这个筛选下还没有错题。</p>}
              </div>
            </div>
          </section>
        )}

        {activeTab === "module" && (
          <section className="app-section">
            {selectedModule ? (
              <div className="panel module-detail">
                <div className="module-detail-head">
                  <div>
                    <span className="kind-badge">知识点模块</span>
                    <h2>{displayModuleTitle(selectedModule.title, selectedModule.note)}</h2>
                    <div className="module-meta detail-meta">
                      <span>{difficultyLabel(selectedModule.difficulty)}</span>
                      <span>{moduleImportanceLabel(selectedModule, visibleModules)}</span>
                      <span>{moduleStatus(selectedModule) === "done" ? "已学习" : moduleStatus(selectedModule) === "doing" ? "学习中" : "待学习"}</span>
                    </div>
                  </div>
                  <button className="secondary" onClick={() => setActiveTab("plan")}><ArrowLeft size={18} weight="bold" />回到计划</button>
                </div>

                <div className="detail-block">
                  <div className="detail-title">
                    <h3>会考什么</h3>
                    <span>根据导入资料推测，优先考虑往年题</span>
                  </div>
                  <RenderHumanText text={selectedModule.exam_points || selectedModule.note || "这个模块还没有考察内容说明，可以重新生成计划或手动补充。"} />
                </div>

                <div className="detail-block explanation-block">
                  <div className="detail-title">
                    <h3>模块讲解</h3>
                    <span>按结论、考点和例题分块阅读</span>
                  </div>
                  {selectedModule.explanation ? <RenderHumanText text={selectedModule.explanation} variant="reading" /> : <p className="muted">需要讲解时，在这里单独生成这个知识点的讲解。</p>}
                  {!selectedModule.explanation && (
                    <div className="actions wrap">
                      <button onClick={() => generateModuleExplanation(selectedModule)} disabled={busy}><Brain size={18} weight="bold" />生成讲解</button>
                    </div>
                  )}
                </div>

                {/* Card Learning */}
                {isStreamingCards ? (
                  <div className="detail-block card-learning-area">
                    <h3>正在生成学习卡片...</h3>
                    <div className="card-progress-dots" style={{ marginBottom: "8px" }}>
                      <span className="card-dot dot-current" /><span className="card-dot dot-current" /><span className="card-dot dot-current" />
                    </div>
                    {streamingCards.length > 0 ? (
                      <div className="card-preview-strip">
                        {streamingCards.map((c) => (<span key={c.id} className="card-preview-chip" title={c.front}>{c.type === "concept" ? "概" : c.type === "mistake" ? "错" : c.type === "exam" ? "考" : "背"} {c.front.slice(0, 12)}…</span>))}
                      </div>
                    ) : <p className="muted">AI 正在生成卡片，请稍候...</p>}
                    <button className="secondary" onClick={cancelStreaming}><ArrowLeft size={16} weight="bold" />取消生成</button>
                  </div>
                ) : cardQueue.length > 0 ? (
                  <div className="detail-block card-learning-area">
                    <div className="card-round-badge">第 {cardLearningRound} 轮 · {currentCardIndex + 1}/{cardQueue.length}</div>
                    <div className="card-progress-dots">
                      {cardQueue.map((c, i) => (<span key={c.id} className={`card-dot ${i < currentCardIndex ? (cardProgress[c.id] === "mastered" ? "dot-mastered" : cardProgress[c.id] === "uncertain" ? "dot-uncertain" : "dot-unknown") : i === currentCardIndex ? "dot-current" : "dot-pending"}`} />))}
                    </div>

                    <p className="flip-hint" onClick={flipCard}>点击翻转卡片</p>

                    <div className="swipe-card-stage">
                      <AnimatePresence initial={false}>
                        {[-1, 0, 1].map((offset) => {
                          const idx = currentCardIndex + offset;
                          if (idx < 0 || idx >= cardQueue.length) return null;
                          const card = cardQueue[idx];
                          const isCenter = offset === 0;
                          return (
                            <motion.div
                              key={card.id}
                              className={`ios-card${isCenter && isCardFlipped ? " flipped" : ""}`}
                              drag={isCenter ? "x" : false}
                              dragConstraints={{ left: -180, right: 180 }}
                              dragElastic={0.12}
                              dragMomentum={false}
                              onDragStart={isCenter ? () => { cardDragLock.current = true; } : undefined}
                              onDragEnd={isCenter ? (_event, info) => {
                                const vx = info.velocity.x;
                                const ox = info.offset.x;
                                finishCardDrag(ox, vx);
                              } : undefined}
                              onClick={isCenter ? () => handleCardTap(flipCard) : () => handleCardTap(() => setCurrentCardIndex(idx))}
                              initial={{ opacity: 0, scale: 0.92, x: offset * 28 }}
                              exit={{ opacity: 0, scale: 0.92, x: offset < 0 ? -96 : 96 }}
                              animate={{
                                x: offset * 16,
                                rotate: 0,
                                scale: isCenter ? 1 : 0.88,
                                y: isCenter ? 0 : Math.abs(offset) * 10,
                                opacity: isCenter ? 1 : 0.45,
                                zIndex: isCenter ? 3 : 1,
                                filter: isCenter ? "blur(0px)" : "blur(1px)",
                              }}
                              transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.55 }}
                            >
                              <div className="swipe-card-inner">
                                <div className="swipe-card-face front">
                                  <span className="card-type-badge">{card.type === "concept" ? "概念" : card.type === "mistake" ? "易错" : card.type === "exam" ? "考题" : "速背"}</span>
                                  <p>{card.front}</p>
                                </div>
                                <div className="swipe-card-face back">
                                  <p>{card.back.answer}</p>
                                  {card.back.examAnswer && <p className="card-exam-answer">考试答法：{card.back.examAnswer}</p>}
                                  {card.back.memoryTip && <p className="card-memory-tip">记忆提示：{card.back.memoryTip}</p>}
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>

                    <p className="swipe-hint">← 左滑下一张 · 右滑上一张 →</p>

                    <div className="card-feedback-buttons">
                      <button className="mini feedback-unknown" onClick={() => submitCardFeedback("unknown")}>还不会</button>
                      <button className="mini feedback-uncertain" onClick={() => submitCardFeedback("uncertain")}>有点模糊</button>
                      <button className="mini feedback-mastered" onClick={() => submitCardFeedback("mastered")}><CheckCircle size={14} weight="bold" />我会了</button>
                    </div>
                    <button className="secondary" style={{ marginTop: "4px" }} onClick={exitCardLearning}><ArrowLeft size={16} weight="bold" />退出学习</button>
                  </div>
                ) : selectedModule.cards?.length ? (
                  <div className="detail-block">
                    <h3>学习卡片 · {selectedModule.cards.length} 张</h3>
                    <div className="card-stack" onClick={() => startCardLearning(selectedModule)}>
                      {selectedModule.cards.map((c, i) => (
                        <div key={c.id} className="stacked-card" style={{ zIndex: selectedModule.cards!.length - i, transform: `translateY(${-i * 3}px) rotate(${(i - (selectedModule.cards!.length-1)/2) * 2}deg)` }}>
                          <span className="card-type-badge">{c.type === "concept" ? "概念" : c.type === "mistake" ? "易错" : c.type === "exam" ? "考题" : "速背"}</span>
                          <p>{c.front.slice(0, 30)}{c.front.length > 30 ? "…" : ""}</p>
                        </div>
                      ))}
                    </div>
                    <p className="muted" style={{ textAlign: "center" }}>点击卡堆开始抽卡学习</p>
                    <div className="actions wrap">
                      <button onClick={() => generateCards(selectedModule)} disabled={busy}><Sparkle size={18} weight="bold" />重新生成</button>
                    </div>
                  </div>
                ) : (
                  <div className="detail-block">
                    <h3>学习卡片</h3>
                    <p className="muted">AI 会围绕这个知识点生成 4~6 张学习卡片，包含概念、易错、考题、速背四种类型。</p>
                    <div className="actions wrap">
                      <button onClick={() => generateCards(selectedModule)} disabled={busy}><Brain size={18} weight="bold" />生成学习卡片</button>
                    </div>
                  </div>
                )}

                <div className="detail-block">
                  <h3>模块模拟题</h3>
                  {selectedModule.practice_questions ? <RenderHumanText text={selectedModule.practice_questions} /> : <p className="muted">学完这个知识点后，可以生成几道只围绕它的小题。</p>}
                  <div className="actions wrap">
                    <button onClick={() => generateModuleQuestions(selectedModule)} disabled={busy}>
                      <ClipboardText size={18} weight="bold" />{selectedModule.practice_questions ? "换一批模拟题" : "生成模块模拟题"}
                    </button>
                    {moduleStatus(selectedModule) !== "done" && <button className="secondary" onClick={() => completeModule(selectedModule)}><CheckCircle size={18} weight="bold" />完成学习</button>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel">
                <p className="muted">先从计划页选择一个知识点模块。</p>
                <button onClick={() => setActiveTab("plan")}><ArrowLeft size={18} weight="bold" />回到计划</button>
              </div>
            )}
          </section>
        )}

        {activeTab === "result" && (
          <section className="app-section">
            <div className="panel plan-preview">
              <span className="kind-badge">AI 生成结果</span>
              <h2>{currentResultNote?.title || "AI 结果"}</h2>
              <RenderHumanText text={currentResultNote?.content || ""} />
              <div className="actions wrap">
                {currentResultNote?.mode === "practice" && <button onClick={() => {
                  setMistakeDraft({ question: currentResultNote.content.slice(0, 220), reason: "从模拟卷保存", fix: "按 AI 解析复盘" });
                  setActiveTab("review");
                  setStatus("已把模拟卷放到错题草稿，可以改完保存。");
                }}><Notebook size={18} weight="bold" />放进错题草稿</button>}
                <button className="secondary" onClick={() => setActiveTab(currentResultNote?.mode === "mock" ? "mock" : "plan")}>
                  <ArrowLeft size={18} weight="bold" />{currentResultNote?.mode === "mock" ? "回到模拟考" : "回到计划页调整"}
                </button>
                <button className="secondary" onClick={() => setActiveTab("materials")}><FileArrowUp size={18} weight="bold" />继续补资料</button>
                {currentResultNote?.mode === "mock" && (
                  <button onClick={async () => {
                    setBusyLabel("正在生成 PDF...");
                    try {
                      await exportMockExamPdf(currentResultNote.content, currentResultNote.title);
                      setStatus("PDF 已下载。");
                    } catch (error) {
                      setStatus(error instanceof Error ? error.message : "PDF 生成失败。");
                    } finally {
                      setBusyLabel("");
                    }
                  }} disabled={busy}><DownloadSimple size={18} weight="bold" />下载 PDF</button>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "review" && !memorizeModuleId && (
          <section className="app-section">
            <div className="panel">
              <div className="panel-heading">
                <span className="heading-icon"><Cards size={20} weight="duotone" /></span>
                <div>
                  <h2>临考速背</h2>
                  <p>按重要程度排列，背完一个「斩」一个。</p>
                </div>
              </div>
              {(dismissedIds.length > 0 || lastDismissedId) && (
                <div className="actions wrap">
                  {lastDismissedId && (
                    <button className="secondary" onClick={() => {
                      setDismissedIds(dismissedIds.filter((id) => id !== lastDismissedId));
                      setLastDismissedId("");
                      setStatus("已撤销。");
                    }}><ArrowLeft size={18} weight="bold" />撤销</button>
                  )}
                  {dismissedIds.length > 0 && (
                    <button className="secondary" onClick={() => {
                      setDismissedIds([]);
                      setLastDismissedId("");
                      setStatus("已重置，所有卡片恢复。");
                    }}><Sparkle size={18} weight="bold" />重置</button>
                  )}
                </div>
              )}
            </div>
            <div className="memorize-list">
              {[...scopedModules]
                .sort((a, b) => (a.importance_rank ?? 999) - (b.importance_rank ?? 999))
                .filter((m) => !dismissedIds.includes(m.id))
                .map((module) => (
                  <article
                    key={module.id}
                    className={`memorize-card${dismissingId === module.id ? " dismissing" : ""}`}
                  >
                    <div className="memorize-card-main" onClick={() => setMemorizeModuleId(module.id)}>
                      <strong>{displayModuleTitle(module.title, module.note)}</strong>
                      <div className="module-meta">
                        <span>{difficultyLabel(module.difficulty)}</span>
                        {module.memorization && <span className="kind-badge">已速背</span>}
                      </div>
                    </div>
                    <button
                      className="mini memorize-zhan"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDismissingId(module.id);
                        setTimeout(() => {
                          setDismissedIds([...dismissedIds, module.id]);
                          setLastDismissedId(module.id);
                          setDismissingId("");
                        }, 300);
                      }}
                    >
                      <CheckCircle size={15} weight="bold" />斩
                    </button>
                  </article>
                ))}
              {[...scopedModules].filter((m) => !dismissedIds.includes(m.id)).length === 0 && (
                <p className="muted">{scopedModules.length ? "全部斩完了！点「重置」重新来过。" : "还没有知识点模块。先去计划页让 AI 生成计划。"}</p>
              )}
            </div>
          </section>
        )}

        {activeTab === "review" && memorizeModuleId && (() => {
          const module = scopedModules.find((m) => m.id === memorizeModuleId);
          if (!module) { setMemorizeModuleId(""); return null; }
          return (
          <section className="app-section">
            <div className="panel">
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <button className="secondary" onClick={() => setMemorizeModuleId("")}><ArrowLeft size={18} weight="bold" />返回列表</button>
                <h2 style={{ margin: 0 }}>{displayModuleTitle(module.title, module.note)}</h2>
              </div>
                <div className="module-meta">
                  <span>{difficultyLabel(module.difficulty)}</span>
                  <span>{moduleImportanceLabel(module, visibleModules)}</span>
                </div>
            </div>

            <div className="panel">
              <h3>考察内容</h3>
              {module.exam_points ? <RenderHumanText text={module.exam_points} /> : <p className="muted">暂无考察内容说明。</p>}
            </div>

            <div className="panel">
              <h3>速背内容</h3>
              {module.memorization ? (
                <RenderHumanText text={module.memorization} />
              ) : (
                <div>
                  <p className="muted">还没有生成速背内容。AI 会根据这个知识点的考察内容，生成核心概念、必背要点、记忆口诀和易错提醒。</p>
                  <button onClick={() => generateMemorizationContent(module)} disabled={busy}><Cards size={18} weight="bold" />生成速背内容</button>
                </div>
              )}
              {module.memorization && (
                <div className="actions wrap" style={{ marginTop: "12px" }}>
                  <button className="secondary" onClick={() => generateMemorizationContent(module)} disabled={busy}><Sparkle size={18} weight="bold" />重新生成</button>
                </div>
              )}
            </div>
          </section>
          );
        })()}

      </section>
    </main>
  );
}
