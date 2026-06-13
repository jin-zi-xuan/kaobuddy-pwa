from __future__ import annotations

import json,os,time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from .ai_client import (
    AiClientError,
    chat_completion,
    chat_completion_stream,
    chat_completion_with_usage,
    estimate_cost_cny,
    estimate_tokens_from_chars,
    server_api_config,
)
from .invites import InviteError, ensure_invite_can_call, invite_limits, record_invite_usage, verify_invite
from .logging import get_logger, redact, set_request_id, log_timing
from .prompts import (
    CARD_SYSTEM_PROMPT,
    DAILY_PLAN_SYSTEM_PROMPT,
    GRADE_PRACTICE_SYSTEM_PROMPT,
    MEMORIZE_SYSTEM_PROMPT,
    MOCK_GRADE_SYSTEM_PROMPT,
    MODULE_PRACTICE_SYSTEM_PROMPT,
    MOCK_SYSTEM_PROMPT,
    OCR_SYSTEM_PROMPT,
    PLAN_SYSTEM_PROMPT,
    PRACTICE_SYSTEM_PROMPT,
    TEACH_SYSTEM_PROMPT,
    format_materials,
    format_project,
)
from .runtime_paths import resolve_runtime_paths
from .schemas import (
    AiRequest,
    AiResponse,
    ChatProxyRequest,
    ChatCompletionRequest,
    ChatMessage,
    DailyPlanRequest,
    HandwritingRequest,
    InviteVerifyRequest,
    InviteVerifyResponse,
    MockGradeRequest,
    ModulePracticeRequest,
    PracticeRequest,
    VideoImportRequest,
    VideoImportResponse,
)
from .video import import_video_metadata

log = get_logger()


PATHS = resolve_runtime_paths()
ROOT_DIR = PATHS.root_dir
STATIC_DIR = PATHS.static_dir
DIST_DIR = PATHS.dist_dir
PUBLIC_DIR = PATHS.public_dir


app = FastAPI(title="KaoBuddy API", version="1.0.0")

_raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173"
)
allowed_origins = [origin.strip() for origin in _raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request ID + timing middleware
# ---------------------------------------------------------------------------

class _RequestTimingMiddleware(BaseHTTPMiddleware):
    """Attach a request_id to every request and log method / path / status / ms."""

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        rid = set_request_id()
        t0 = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((time.monotonic() - t0) * 1000)
            log.warning(
                "request unhandled",
                method=request.method,
                path=request.url.path,
                status=500,
                duration_ms=duration_ms,
                request_id=rid,
                exc=True,
            )
            raise
        duration_ms = round((time.monotonic() - t0) * 1000)
        level = "warning" if response.status_code >= 400 else "info"
        getattr(log, level)(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
            request_id=rid,
        )
        return response


app.add_middleware(_RequestTimingMiddleware)


# ---------------------------------------------------------------------------
# CSP middleware — protect against XSS
# ---------------------------------------------------------------------------

class _CspMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Any) -> Response:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https:; "
            "connect-src 'self' https:; "
            "media-src 'none'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        return response


app.add_middleware(_CspMiddleware)


# ---------------------------------------------------------------------------
# Global exception handler — catches unhandled exceptions from routes
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> Response:
    # Let HTTPExceptions pass through (they're already logged by the middleware)
    if isinstance(exc, HTTPException):
        raise exc
    log.error(
        "unhandled exception",
        method=request.method,
        path=request.url.path,
        exc_info=exc,
    )
    raise exc


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
ASSETS_DIR = DIST_DIR / "assets" if (DIST_DIR / "assets").exists() else STATIC_DIR / "assets"
ICONS_DIR = DIST_DIR / "icons" if (DIST_DIR / "icons").exists() else STATIC_DIR / "icons"
PLAN_CHUNK_SIZE = 8000
PLAN_MIN_TOKENS = 8000
if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
if ICONS_DIR.exists():
    app.mount("/icons", StaticFiles(directory=ICONS_DIR), name="icons")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    dist_index = DIST_DIR / "index.html"
    return FileResponse(dist_index if dist_index.exists() else STATIC_DIR / "index.html")


@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest() -> FileResponse:
    dist_manifest = DIST_DIR / "manifest.webmanifest"
    static_manifest = STATIC_DIR / "manifest.webmanifest"
    if dist_manifest.exists():
        return FileResponse(dist_manifest)
    return FileResponse(static_manifest if static_manifest.exists() else PUBLIC_DIR / "manifest.webmanifest")


@app.get("/sw.js", include_in_schema=False)
async def service_worker() -> FileResponse:
    dist_worker = DIST_DIR / "sw.js"
    static_worker = STATIC_DIR / "sw.js"
    if dist_worker.exists():
        return FileResponse(dist_worker)
    return FileResponse(static_worker if static_worker.exists() else PUBLIC_DIR / "sw.js")


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


def _content_length(content: Any) -> int:
    if isinstance(content, str):
        return len(content)
    return len(json.dumps(content, ensure_ascii=False))


def _messages_char_count(messages: list[ChatMessage]) -> int:
    return sum(_content_length(message.content) for message in messages)


def _response_from_invite(content: str, invite_code: str, usage: dict[str, Any], fallback_prompt_chars: int) -> AiResponse:
    try:
        prompt_tokens = int(usage.get("prompt_tokens", 0))
    except (TypeError, ValueError):
        prompt_tokens = 0
    try:
        completion_tokens = int(usage.get("completion_tokens", 0))
    except (TypeError, ValueError):
        completion_tokens = 0
    if prompt_tokens <= 0:
        prompt_tokens = estimate_tokens_from_chars(fallback_prompt_chars)
    if completion_tokens <= 0:
        completion_tokens = estimate_tokens_from_chars(len(content))
    cost = estimate_cost_cny(prompt_tokens, completion_tokens)
    status = record_invite_usage(invite_code, cost)
    log.info(
        "invite usage",
        invite_code=redact(invite_code),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_cny=cost,
        remaining=status.remaining,
        remaining_budget_cny=status.remaining_budget_cny,
    )
    return AiResponse(content=content, remaining=status.remaining, remaining_budget_cny=status.remaining_budget_cny)


def _resolve_auth(
    request: AiRequest | ChatCompletionRequest | DailyPlanRequest | HandwritingRequest,
    prompt_chars: int,
    minimum_tokens: int | None = None,
) -> tuple[Any, str | None]:
    """Resolve API config + optional invite_code from a request.

    Returns ``(api_config, invite_code | None)``.  Validates invite limits
    (budget / size) before returning so every caller gets the same checks.
    """
    # --- BYOK path -----------------------------------------------------------
    if request.api_config:
        api_config = request.api_config
        if minimum_tokens and api_config.max_tokens < minimum_tokens:
            api_config = api_config.model_copy(update={"max_tokens": minimum_tokens})
        log.info("ai auth", auth="custom", provider=api_config.provider_name, model=api_config.model)
        return api_config, None

    # --- Invite path ---------------------------------------------------------
    invite_code = (request.invite_code or "").strip()
    if not invite_code:
        raise HTTPException(status_code=400, detail="请先填写邀请码，或切换到自带 API Key 模式。")

    max_chars, max_tokens = invite_limits()
    if prompt_chars > max_chars:
        log.info("request too large for invite", invite_code=redact(invite_code), prompt_chars=prompt_chars, max_chars=max_chars)
        raise HTTPException(status_code=413, detail="这次请求内容太长了，请缩短资料或切换到自带 API Key。")

    desired_tokens = minimum_tokens or 1800
    capped_tokens = min(max_tokens, max(128, desired_tokens))
    try:
        api_config = server_api_config(max_tokens=capped_tokens)
    except AiClientError as exc:
        log.warning("ai call failed", auth="invite", error=str(exc)[:300])
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    expected_cost = estimate_cost_cny(estimate_tokens_from_chars(prompt_chars), capped_tokens)
    try:
        ensure_invite_can_call(invite_code, expected_cost)
    except InviteError as exc:
        log.info("invite rejected", invite_code=redact(invite_code), error=str(exc))
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    log.info("ai auth", auth="invite", provider=api_config.provider_name, model=api_config.model)
    return api_config, invite_code


async def _chat_for_request(request: AiRequest | ChatCompletionRequest | DailyPlanRequest | HandwritingRequest, messages: list[ChatMessage], minimum_tokens: int | None = None) -> AiResponse:
    prompt_chars = _messages_char_count(messages)
    api_config, invite_code = _resolve_auth(request, prompt_chars, minimum_tokens)

    if not invite_code:
        with log_timing(log, "ai call",
                        auth="custom",
                        provider=api_config.provider_name,
                        model=api_config.model,
                        prompt_chars=prompt_chars,
                        max_tokens=api_config.max_tokens):
            try:
                content = await chat_completion(api_config, messages)
            except AiClientError as exc:
                log.warning("ai call failed", auth="custom", provider=api_config.provider_name, model=api_config.model, error=str(exc)[:300])
                raise HTTPException(status_code=502, detail=str(exc)) from exc
        return AiResponse(content=content)

    # Invite path
    capped_tokens = api_config.max_tokens
    try:
        with log_timing(log, "ai call",
                        auth="invite",
                        provider=api_config.provider_name,
                        model=api_config.model,
                        prompt_chars=prompt_chars,
                        max_tokens=capped_tokens):
            content, usage = await chat_completion_with_usage(api_config, messages)
        return _response_from_invite(content, invite_code, usage, prompt_chars)
    except AiClientError as exc:
        log.warning("ai call failed", auth="invite", model=api_config.model, error=str(exc)[:300])
        raise HTTPException(status_code=502, detail=str(exc)) from exc


async def _run_ai(request: AiRequest, system_prompt: str, task_prompt: str, minimum_tokens: int | None = None) -> AiResponse:
    user_content = (
        f"{task_prompt}\n\n"
        f"【考试项目】\n{format_project(request.project)}\n\n"
        f"【资料】\n{format_materials(request.materials)}\n\n"
        f"【补充要求】\n{request.extra or '无'}"
    )
    messages = [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(role="user", content=user_content),
    ]
    return await _chat_for_request(request, messages, minimum_tokens)


def _plan_material_chunks(request: AiRequest) -> list[str]:
    chunks: list[str] = []
    for material in request.materials:
        content = material.content.strip()
        if not content:
            continue
        total = len(content)
        for start in range(0, total, PLAN_CHUNK_SIZE):
            end = min(start + PLAN_CHUNK_SIZE, total)
            source_id = f"，id：{material.id}" if material.id else ""
            chunks.append(
                f"## 资料片段 {len(chunks) + 1}\n"
                f"资料：{material.title}（{material.kind}{source_id}）\n"
                f"字符范围：{start + 1}-{end} / {total}\n"
                f"{content[start:end]}"
            )
    return chunks


def _coverage_instruction(target_score: str | None) -> str:
    raw_score = (target_score or "").strip()
    try:
        score = float(raw_score)
    except ValueError:
        score = 0
    if score >= 90:
        return (
            "【覆盖率要求】\n"
            "用户目标是 90 分以上，请按高覆盖率抽取知识点：资料里出现的章节标题、二级标题、定义、机制、算法、条件、步骤、优缺点、典型题型和易错点都要尽量拆出来。"
            "不要只抽章节标题；如果一个章节下面有多个可考概念，要拆成多个模块，并用 evidence 标明依据。"
        )
    return (
        "【覆盖率要求】\n"
        "按资料里的明确知识点完整抽取，优先覆盖章节标题、定义、机制、算法、典型题型和易错点。"
    )


async def _run_plan(request: AiRequest) -> AiResponse:
    chunks = _plan_material_chunks(request)
    if not chunks:
        log.info("plan generation start", chunks=0, material_count=len(request.materials))
        return await _run_ai(
            request,
            PLAN_SYSTEM_PROMPT,
            "请只根据导入资料抽取知识点卡片模块，不按日期排，不按每天学习时长安排。每个模块必须包含知识点名称、预计完成时间、难度、重要程度排名、考察内容、建议练习方式、资料来源和证据。",
            PLAN_MIN_TOKENS,
        )

    log.info("plan generation start", chunks=len(chunks), material_count=len(request.materials))
    plan_outputs: list[str] = []
    last_remaining: int | None = None
    last_remaining_budget_cny: float | None = None
    coverage_instruction = _coverage_instruction(request.project.target_score)
    for index, chunk in enumerate(chunks, start=1):
        log.info("plan chunk processing", chunk=index, total_chunks=len(chunks))
        user_content = (
            '请从下面这一段导入资料中完整抽取知识点模块。考试时间和目标分数用于排序、估时和练习建议，但不要因为时间紧就漏掉本片段明确出现的知识点。不要补齐本片段没有依据的模块；如果需要补充背景，只能写在考察内容里的"补充理解"。\n\n'
            f"【考试项目】\n{format_project(request.project)}\n\n"
            f"{coverage_instruction}\n\n"
            f"【资料】\n{chunk}\n\n"
            f"【补充要求】\n{request.extra or '无'}"
        )
        messages = [
            ChatMessage(role="system", content=PLAN_SYSTEM_PROMPT),
            ChatMessage(role="user", content=user_content),
        ]
        response = await _chat_for_request(request, messages, PLAN_MIN_TOKENS)
        last_remaining = response.remaining
        last_remaining_budget_cny = response.remaining_budget_cny
        plan_outputs.append(f"资料片段 {index} 抽取结果\n{response.content}")

    prefix = f"长资料已分块处理：本次处理 {len(chunks)} 个资料片段。"
    log.info("plan generation done", chunks=len(chunks))
    return AiResponse(
        content=f"{prefix}\n\n" + "\n\n".join(plan_outputs),
        remaining=last_remaining,
        remaining_budget_cny=last_remaining_budget_cny,
    )


def _format_daily_plan_modules(request: DailyPlanRequest) -> str:
    if not request.modules:
        return "暂无未完成知识点模块。"
    lines = []
    for module in request.modules:
        lines.append(
            "\n".join(
                [
                    f"模块ID：{module.id}",
                    f"知识点：{module.title}",
                    f"预计时间：{module.estimated_minutes} 分钟",
                    f"状态：{module.module_status}",
                    f"重要排名：{module.importance_rank or '未填写'}",
                    f"难度：{module.difficulty or '未填写'}",
                    f"考察内容：{module.exam_points or '未填写'}",
                    f"资料来源：{module.source_title or '未填写'}",
                    f"资料证据：{module.evidence or '未填写'}",
                ]
            )
        )
    return "\n\n".join(lines)


async def _run_daily_plan(request: DailyPlanRequest) -> AiResponse:
    try:
        exam_date = date.fromisoformat(request.project.exam_date)
    except (ValueError, TypeError):
        exam_date = date.today() + timedelta(days=30)
    today = date.today()
    days_remaining = max(1, (exam_date - today).days)
    total_dates = [(today + timedelta(days=i)).isoformat() for i in range(days_remaining + 1)]
    total_module_minutes = sum(m.estimated_minutes for m in request.modules)

    user_content = (
        f"今天 {today.isoformat()}，考试 {exam_date.isoformat()}，共 {len(total_dates)} 天。\n"
        f"考试日期：{exam_date.isoformat()}\n"
        f"每天可学习：{request.project.daily_minutes} 分钟\n"
        f"目标分数：{request.project.target_score or '未填写'}\n"
        f"每天最多 {request.project.daily_minutes} 分钟，所有模块共 {total_module_minutes} 分钟。\n\n"
        f"请把下面 {len(request.modules)} 个模块分配到 {total_dates[0]} ~ {total_dates[-1]} 的每一天：\n"
        f"{_format_daily_plan_modules(request)}\n\n"
        f"补充要求：{request.extra or '无'}"
    )
    messages = [
        ChatMessage(role="system", content=DAILY_PLAN_SYSTEM_PROMPT),
        ChatMessage(role="user", content=user_content),
    ]
    return await _chat_for_request(request, messages, 4000)


def _request_with_min_tokens(request: AiRequest, minimum: int) -> AiRequest:
    if not request.api_config:
        return request
    current = request.api_config.max_tokens
    if current >= minimum:
        return request
    return request.model_copy(update={"api_config": request.api_config.model_copy(update={"max_tokens": minimum})})


@app.post("/api/ai/test", response_model=AiResponse)
async def test_ai(request: ChatCompletionRequest) -> AiResponse:
    messages = request.messages or [
        ChatMessage(role="user", content="请回复：连接成功"),
    ]
    return await _chat_for_request(request, messages)


@app.post("/api/invite/verify", response_model=InviteVerifyResponse)
async def verify_invite_code(request: InviteVerifyRequest) -> InviteVerifyResponse:
    status = verify_invite(request.code)
    log.info(
        "invite verify",
        invite_code=redact(request.code),
        valid=status.valid,
        remaining=status.remaining,
        remaining_budget_cny=status.remaining_budget_cny,
    )
    return InviteVerifyResponse(
        valid=status.valid,
        remaining=status.remaining,
        remainingBudgetCny=status.remaining_budget_cny,
        message=status.message,
    )


@app.post("/api/ai/chat", response_model=AiResponse)
async def invite_chat(request: ChatProxyRequest) -> AiResponse:
    proxy = ChatCompletionRequest(inviteCode=request.invite_code, messages=request.messages)
    return await _chat_for_request(proxy, request.messages)


@app.post("/api/ai/plan", response_model=AiResponse)
async def make_plan(request: AiRequest) -> AiResponse:
    return await _run_plan(request)


@app.post("/api/ai/daily-plan", response_model=AiResponse)
async def make_daily_plan(request: DailyPlanRequest) -> AiResponse:
    return await _run_daily_plan(request)


@app.post("/api/ai/memorize", response_model=AiResponse)
async def memorize(request: AiRequest) -> AiResponse:
    return await _run_ai(
        request,
        MEMORIZE_SYSTEM_PROMPT,
        "请根据资料和补充要求中的知识点，生成可直接背诵的考前速记内容。",
    )


@app.post("/api/ai/teach", response_model=AiResponse)
async def teach(request: AiRequest) -> AiResponse:
    return await _run_ai(
        request,
        TEACH_SYSTEM_PROMPT,
        "请围绕资料里的核心考点进行讲解，按零基础解释、高频考点、例题、易错点组织。",
    )


@app.post("/api/ai/cards", response_model=AiResponse)
async def generate_cards(request: AiRequest) -> AiResponse:
    return await _run_ai(
        request,
        CARD_SYSTEM_PROMPT,
        "请根据【补充要求】中指定的知识点和考察内容，生成 4~6 张学习卡片的 JSON 数组。",
        6000,
    )


@app.post("/api/ai/cards/stream")
async def generate_cards_stream(request: AiRequest):
    """Stream card generation via SSE."""
    t0 = time.monotonic()
    user_content = (
        "请根据【补充要求】中指定的知识点和考察内容，生成 4~6 张学习卡片的 JSON 数组。\n\n"
        f"【考试项目】\n{format_project(request.project)}\n\n"
        f"【资料】\n{format_materials(request.materials)}\n\n"
        f"【补充要求】\n{request.extra or '无'}"
    )
    messages = [
        ChatMessage(role="system", content=CARD_SYSTEM_PROMPT),
        ChatMessage(role="user", content=user_content),
    ]

    prompt_chars = _messages_char_count(messages)
    api_config, invite_code = _resolve_auth(request, prompt_chars, 6000)

    log.info("cards stream start", model=api_config.model, prompt_chars=prompt_chars)

    async def event_stream():
        chunk_count = 0
        full_text = ""
        try:
            async for chunk in chat_completion_stream(api_config, messages):
                chunk_count += 1
                full_text += chunk
                yield f"data: {json.dumps({'t': chunk})}\n\n"
            yield "data: [DONE]\n\n"
            duration_ms = round((time.monotonic() - t0) * 1000)
            log.info("cards stream done", model=api_config.model, chunks=chunk_count, duration_ms=duration_ms)
            # Record invite usage for the stream call
            if invite_code:
                try:
                    _response_from_invite(full_text, invite_code, {}, prompt_chars)
                except Exception:
                    pass
        except AiClientError as exc:
            duration_ms = round((time.monotonic() - t0) * 1000)
            log.warning("cards stream failed", model=api_config.model, error=str(exc)[:300], duration_ms=duration_ms)
            yield f"data: {json.dumps({'e': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/ai/practice", response_model=AiResponse)
async def practice(request: PracticeRequest) -> AiResponse:
    answer_text = "\n".join(f"题目：{item.question}\n作答：{item.answer}" for item in request.answers) or "用户还没有提交答案，请先生成练习题。"
    enriched = AiRequest(
        api_config=request.api_config,
        inviteCode=request.invite_code,
        project=request.project,
        materials=request.materials,
        extra=f"{request.extra or ''}\n\n【用户作答】\n{answer_text}",
    )
    return await _run_ai(
        enriched,
        PRACTICE_SYSTEM_PROMPT,
        "请生成或批改一组练习题，给出题目、参考答案、解析和薄弱项提醒。",
    )


@app.post("/api/ai/module-practice", response_model=AiResponse)
async def module_practice(request: ModulePracticeRequest) -> AiResponse:
    return await _run_ai(
        request,
        MODULE_PRACTICE_SYSTEM_PROMPT,
        (
            f"当前知识点：{request.module_title}\n"
            f"考察内容：{request.exam_points or '按资料判断'}\n"
            "请只围绕这个知识点生成 3 道模块内模拟题，包含题目、参考答案和完整解析。"
            "如果题目里出现表格，请直接排成清楚的表格。不要在解析中途停止。"
        ),
        5000,
    )


@app.post("/api/ai/grade-practice", response_model=AiResponse)
async def grade_practice(request: PracticeRequest) -> AiResponse:
    answer_text = "\n".join(
        f"第{i+1}题：{item.question}\n学生作答：{item.answer}"
        for i, item in enumerate(request.answers)
    ) or "学生未提交任何答案。"
    enriched = AiRequest(
        api_config=request.api_config,
        inviteCode=request.invite_code,
        project=request.project,
        materials=request.materials,
        extra=f"【原始练习题】\n{request.extra or '无'}\n\n【学生作答】\n{answer_text}",
    )
    return await _run_ai(
        enriched,
        GRADE_PRACTICE_SYSTEM_PROMPT,
        "请逐题批改学生的练习答案，给出对错判断、错因分析、正确答案和整体评价。",
        5000,
    )


@app.post("/api/ai/mock-exam", response_model=AiResponse)
async def mock_exam(request: AiRequest) -> AiResponse:
    return await _run_ai(
        request,
        MOCK_SYSTEM_PROMPT,
        "请根据补充要求中指定的考试时长生成对应题量的模拟卷。",
    )


@app.post("/api/ai/grade-mock", response_model=AiResponse)
async def grade_mock(request: MockGradeRequest) -> AiResponse:
    user_content = (
        f"【考试项目】\n{format_project(request.project)}\n\n"
        f"【模考试卷（含参考答案）】\n{request.exam_content}\n\n"
        f"【考生作答】\n{request.user_answers}\n\n"
        f"请逐题评分：选择题对答案字母即可，简答题按【题目解析】中的得分要点逐点给分，"
        f"考生措辞不需要和参考答案完全一致，要点意思对就得分。"
        f"最后给出总分、正确率和薄弱知识点。"
    )
    messages = [
        ChatMessage(role="system", content=MOCK_GRADE_SYSTEM_PROMPT),
        ChatMessage(role="user", content=user_content),
    ]
    wrapper = AiRequest(
        api_config=request.api_config,
        inviteCode=request.invite_code,
        project=request.project,
        materials=request.materials,
    )
    return await _chat_for_request(wrapper, messages, 8000)


@app.post("/api/ocr/handwriting", response_model=AiResponse)
async def handwriting_ocr(request: HandwritingRequest) -> AiResponse:
    content = [
        {
            "type": "text",
            "text": f"请识别这些手写笔记。补充说明：{request.note_hint or '无'}",
        }
    ]
    for image_data_url in request.image_data_urls:
        content.append({"type": "image_url", "image_url": {"url": image_data_url}})

    messages = [
        ChatMessage(role="system", content=OCR_SYSTEM_PROMPT),
        ChatMessage(role="user", content=content),
    ]
    return await _chat_for_request(request, messages)


@app.post("/api/video/import", response_model=VideoImportResponse)
async def import_video(request: VideoImportRequest) -> VideoImportResponse:
    try:
        with log_timing(log, "video import", url=str(request.url)[:120]):
            result = await import_video_metadata(str(request.url))
        log.info("video import done", title=result.title, has_subtitles=bool(result.subtitles), warnings=len(result.warnings))
        return result
    except Exception as exc:
        log.warning("video import failed", url=str(request.url)[:120], error=str(exc)[:300])
        raise HTTPException(status_code=502, detail=f"视频信息读取失败：{exc}") from exc


# SPA fallback — return index.html for any unmatched client-side path.
# Must be registered last so it does not shadow API routes or static mounts.
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str) -> FileResponse:
    dist_index = DIST_DIR / "index.html"
    return FileResponse(dist_index if dist_index.exists() else STATIC_DIR / "index.html")
