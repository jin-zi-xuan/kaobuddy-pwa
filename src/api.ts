import type { ApiConfig, StudyMaterial, StudyProject, StudyTask } from "./types";

const API_BASE = "";

export type AiAuthPayload = { api_config: ApiConfig; inviteCode?: never } | { inviteCode: string; api_config?: never };

export type AiResult = {
  content: string;
  remaining?: number;
  remainingBudgetCny?: number;
};

type AiPayload = AiAuthPayload & {
  project: Omit<StudyProject, "id" | "created_at" | "updated_at">;
  materials: Pick<StudyMaterial, "id" | "title" | "kind" | "content">[];
  extra?: string;
};

const LOCAL_BACKEND_OFFLINE_MESSAGE = "请求没有到达 KaoBuddy 后端，本地后端可能没有启动。请用 npm run dev 启动完整开发环境，或者双击 open-kaobuddy.command / open-kaobuddy.bat。";

export async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (!data || typeof data !== "object") {
      throw new Error(LOCAL_BACKEND_OFFLINE_MESSAGE);
    }
    throw new Error(formatApiError((data as { detail?: unknown }).detail));
  }
  return (data || {}) as T;
}

function formatApiError(detail: unknown): string {
  if (!detail) return "请求失败，请稍后再试。";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) return String(item.msg);
        return "";
      })
      .filter(Boolean);
    return messages.join("；") || "请求内容格式不对，请检查后再试。";
  }
  if (typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }
  return "请求内容格式不对，请检查后再试。";
}

export async function testApiConfig(api_config: ApiConfig): Promise<string> {
  const response = await fetch(`${API_BASE}/api/ai/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_config,
      messages: [{ role: "user", content: "请只回复：连接成功" }]
    })
  });
  const data = await parseApiResponse<{ content: string }>(response);
  return data.content;
}

export async function verifyInviteCode(code: string): Promise<{
  valid: boolean;
  remaining: number;
  remainingBudgetCny: number;
  message: string;
}> {
  const response = await fetch(`${API_BASE}/api/invite/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  return parseApiResponse(response);
}

export async function runAi(mode: "plan" | "teach" | "practice" | "mock-exam", payload: AiPayload, signal?: AbortSignal): Promise<AiResult> {
  const endpoint = mode === "mock-exam" ? "/api/ai/mock-exam" : `/api/ai/${mode}`;
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  return parseApiResponse<AiResult>(response);
}

export async function runMemorize(payload: AiPayload): Promise<AiResult> {
  const response = await fetch(`${API_BASE}/api/ai/memorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseApiResponse<AiResult>(response);
}

export async function runModulePractice(payload: AiPayload & { module_title: string; exam_points?: string }): Promise<AiResult> {
  const response = await fetch(`${API_BASE}/api/ai/module-practice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseApiResponse<AiResult>(response);
}

export async function runCards(payload: AiPayload): Promise<AiResult> {
  const response = await fetch(`${API_BASE}/api/ai/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseApiResponse<AiResult>(response);
}

export async function runCardsStream(
  payload: AiPayload,
  onChunk: (text: string) => void,
  onError: (error: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/ai/cards/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    await parseApiResponse(response);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("浏览器不支持流式读取。");
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.t) {
          fullText += parsed.t;
          onChunk(parsed.t);
        } else if (parsed.e) {
          onError(parsed.e);
          return fullText;
        }
      } catch { /* skip malformed */ }
    }
  }
  return fullText;
}

export async function gradeMock(payload: AiAuthPayload & {
  project: Omit<StudyProject, "id" | "created_at" | "updated_at">;
  materials: Pick<StudyMaterial, "id" | "title" | "kind" | "content">[];
  exam_content: string;
  user_answers: string;
}): Promise<AiResult> {
  const response = await fetch(`${API_BASE}/api/ai/grade-mock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseApiResponse<AiResult>(response);
}

export async function gradePractice(payload: AiAuthPayload & {
  project: Omit<StudyProject, "id" | "created_at" | "updated_at">;
  materials: Pick<StudyMaterial, "id" | "title" | "kind" | "content">[];
  extra?: string;
  answers: { question: string; answer: string }[];
}): Promise<AiResult> {
  const response = await fetch(`${API_BASE}/api/ai/grade-practice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseApiResponse<AiResult>(response);
}

export async function runDailyPlan(payload: AiAuthPayload & {
  project: Omit<StudyProject, "id" | "created_at" | "updated_at">;
  modules: Pick<StudyTask, "id" | "title" | "estimated_minutes" | "difficulty" | "importance_rank" | "exam_points" | "source_title" | "evidence" | "module_status">[];
  extra?: string;
}, signal?: AbortSignal): Promise<AiResult> {
  const response = await fetch(`${API_BASE}/api/ai/daily-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  return parseApiResponse<AiResult>(response);
}

export async function importVideo(url: string) {
  const response = await fetch(`${API_BASE}/api/video/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  return parseApiResponse<{
    title: string;
    description: string;
    subtitles: string;
    source_url: string;
    warnings: string[];
  }>(response);
}

export async function recognizeHandwriting(auth: AiAuthPayload, image_data_urls: string[], note_hint?: string): Promise<AiResult> {
  const response = await fetch(`${API_BASE}/api/ocr/handwriting`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...auth, image_data_urls, note_hint })
  });
  return parseApiResponse<AiResult>(response);
}
