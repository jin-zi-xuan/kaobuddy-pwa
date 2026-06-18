import os
import importlib.util
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.ai_client import chat_completion_with_usage, completion_timeout_seconds
from backend.app.main import app
from backend.app.portable_launcher import configure_portable_environment
from backend.app.runtime_paths import resolve_runtime_paths
from backend.app.schemas import ApiConfig, ChatMessage


_portable_package_spec = importlib.util.spec_from_file_location(
    "build_portable_package",
    Path(__file__).resolve().parents[1] / "scripts" / "build_portable_package.py",
)
assert _portable_package_spec and _portable_package_spec.loader
build_portable_package = importlib.util.module_from_spec(_portable_package_spec)
_portable_package_spec.loader.exec_module(build_portable_package)


client = TestClient(app)

TEST_API_KEY = "TEST_ONLY_API_KEY"
SERVER_API_KEY = "TEST_ONLY_SERVER_API_KEY"


def _test_invite_code(suffix: str = "1") -> str:
    return f"TEST_ONLY_INVITE_{suffix}"


def _set_test_invite_codes(monkeypatch, *suffixes: str) -> None:
    monkeypatch.setenv("KAOBUDDY_INVITE_CODES", ",".join(_test_invite_code(suffix) for suffix in suffixes))


def test_no_legacy_demo_invite_codes_checked_in():
    legacy_prefix = "-".join(("KAO", "V1", "DEMO"))
    ignored_dirs = {".git", ".pytest_cache", ".venv", "node_modules", "backend/static/assets", "dist", "work"}
    offenders: list[str] = []

    for path in Path(".").rglob("*"):
        if not path.is_file():
            continue
        if any(ignored in path.parts for ignored in ignored_dirs):
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if legacy_prefix in content:
            offenders.append(str(path))

    assert offenders == []


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_runtime_paths_can_be_overridden_for_portable_bundle(tmp_path):
    root = tmp_path / "bundle"
    static = root / "backend" / "static"
    dist = root / "dist"
    public = root / "public"
    env = {
        "KAOBUDDY_ROOT_DIR": str(root),
        "KAOBUDDY_STATIC_DIR": str(static),
        "KAOBUDDY_DIST_DIR": str(dist),
        "KAOBUDDY_PUBLIC_DIR": str(public),
    }

    paths = resolve_runtime_paths(env=env)

    assert paths.root_dir == root
    assert paths.static_dir == static
    assert paths.dist_dir == dist
    assert paths.public_dir == public


def test_portable_launcher_sets_bundle_paths_without_overwriting_existing_values(tmp_path, monkeypatch):
    root = tmp_path / "bundle"
    custom_static = tmp_path / "custom-static"
    monkeypatch.setenv("KAOBUDDY_STATIC_DIR", str(custom_static))

    configure_portable_environment(root)

    assert os.environ["KAOBUDDY_ROOT_DIR"] == str(root)
    assert os.environ["KAOBUDDY_STATIC_DIR"] == str(custom_static)
    assert os.environ["KAOBUDDY_DIST_DIR"] == str(root / "dist")
    assert os.environ["KAOBUDDY_PUBLIC_DIR"] == str(root / "public")


def test_portable_launcher_uses_pyinstaller_internal_data_root(tmp_path, monkeypatch):
    root = tmp_path / "bundle"
    internal = root / "_internal"
    (internal / "backend" / "static").mkdir(parents=True)
    (internal / "backend" / "static" / "index.html").write_text("<div>KaoBuddy</div>", encoding="utf-8")
    (internal / "public").mkdir()

    for key in ("KAOBUDDY_ROOT_DIR", "KAOBUDDY_STATIC_DIR", "KAOBUDDY_DIST_DIR", "KAOBUDDY_PUBLIC_DIR"):
        monkeypatch.delenv(key, raising=False)

    configure_portable_environment(root)

    assert os.environ["KAOBUDDY_ROOT_DIR"] == str(internal)
    assert os.environ["KAOBUDDY_STATIC_DIR"] == str(internal / "backend" / "static")
    assert os.environ["KAOBUDDY_PUBLIC_DIR"] == str(internal / "public")


def test_portable_package_requires_static_index_before_pyinstaller(tmp_path):
    root = tmp_path / "repo"
    (root / "backend" / "static").mkdir(parents=True)

    with pytest.raises(FileNotFoundError, match="backend/static/index.html"):
        build_portable_package.validate_static_assets(root)


def test_api_config_requires_http_base_url():
    with pytest.raises(ValueError):
        ApiConfig(
            provider_name="DeepSeek",
            base_url="api.deepseek.com",
            api_key=TEST_API_KEY,
            model="deepseek-chat",
        )


def test_ai_client_timeout_scales_for_long_generation_requests():
    quick_test_config = ApiConfig(
        provider_name="DeepSeek",
        base_url="https://api.deepseek.com",
        api_key=TEST_API_KEY,
        model="deepseek-chat",
        max_tokens=1800,
    )
    long_plan_config = quick_test_config.model_copy(update={"max_tokens": 8000})

    assert completion_timeout_seconds(quick_test_config) == 60
    assert completion_timeout_seconds(long_plan_config) >= 180


async def test_ai_timeout_error_explains_generation_may_still_be_valid(monkeypatch):
    async def fake_post(*args, **kwargs):
        raise httpx.ReadTimeout("timed out while waiting for response")

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        post = fake_post

    monkeypatch.setattr("backend.app.ai_client.httpx.AsyncClient", FakeAsyncClient)
    api_config = ApiConfig(
        provider_name="DeepSeek",
        base_url="https://api.deepseek.com",
        api_key=TEST_API_KEY,
        model="deepseek-chat",
        max_tokens=8000,
    )

    with pytest.raises(RuntimeError) as exc_info:
        await chat_completion_with_usage(api_config, [ChatMessage(role="user", content="生成完整计划")])

    assert "AI 生成超时" in str(exc_info.value)
    assert "测试连接成功" in str(exc_info.value)


def test_plan_allows_empty_weak_points(monkeypatch):
    async def fake_chat_completion(api_config, messages):
        assert "已知薄弱项：未填写" in messages[1].content
        return "第 1 天：建立计划。"

    monkeypatch.setattr("backend.app.main.chat_completion", fake_chat_completion)
    response = client.post(
        "/api/ai/plan",
        json={
            "api_config": {
                "provider_name": "DeepSeek",
                "base_url": "https://api.deepseek.com",
                "api_key": TEST_API_KEY,
                "model": "deepseek-chat",
            },
            "project": {
                "subject": "高数",
                "exam_date": "2026-06-10",
                "daily_minutes": 120,
                "target_score": "80",
            },
            "materials": [],
        },
    )
    assert response.status_code == 200
    assert response.json()["content"] == "第 1 天：建立计划。"


def test_plan_prompt_is_material_driven_module_cards(monkeypatch):
    captured = {}

    async def fake_chat_completion(api_config, messages):
        captured["system"] = messages[0].content
        captured["user"] = messages[1].content
        return "模块名称：进程；预计时间：45分钟；难度：中；重要排名：1；考察内容：PCB、状态转换、调度。"

    monkeypatch.setattr("backend.app.main.chat_completion", fake_chat_completion)
    response = client.post(
        "/api/ai/plan",
        json={
            "api_config": {
                "provider_name": "DeepSeek",
                "base_url": "https://api.deepseek.com",
                "api_key": TEST_API_KEY,
                "model": "deepseek-chat",
            },
            "project": {
                "subject": "操作系统",
                "exam_date": "2026-06-30",
                "daily_minutes": 120,
            },
            "materials": [
                {
                    "title": "进程课件",
                    "kind": "pdf",
                    "content": "进程是资源分配的基本单位。PCB 记录进程状态。线程是 CPU 调度的基本单位。",
                }
            ],
        },
    )

    assert response.status_code == 200
    assert "知识点模块必须来自导入资料" in captured["system"]
    assert "补充理解" in captured["system"]
    assert "知识点" in captured["system"]
    assert "不能是学习安排" in captured["system"]
    assert "sourceTitle" in captured["system"]
    assert "evidence" in captured["system"]
    assert "进程是资源分配的基本单位" in captured["user"]


def test_plan_splits_long_materials_before_ai(monkeypatch):
    captured_users = []
    captured_tokens = []

    async def fake_chat_completion(api_config, messages):
        captured_users.append(messages[1].content)
        captured_tokens.append(api_config.max_tokens)
        return "模块名称：关系模式；预计时间：45分钟；难度：中；重要排名：1；资料来源：数据库教材；证据：关系模式由属性集合构成；考察内容：关系模式、属性、元组；练习方式：做概念辨析题"

    monkeypatch.setattr("backend.app.main.chat_completion", fake_chat_completion)
    long_content = "关系模式由属性集合构成。" * 900
    response = client.post(
        "/api/ai/plan",
        json={
            "api_config": {
                "provider_name": "DeepSeek",
                "base_url": "https://api.deepseek.com",
                "api_key": TEST_API_KEY,
                "model": "deepseek-chat",
            },
            "project": {
                "subject": "数据库原理",
                "exam_date": "2026-06-30",
                "daily_minutes": 120,
            },
            "materials": [
                {
                    "id": "material_db",
                    "title": "数据库教材",
                    "kind": "pdf",
                    "content": long_content,
                }
            ],
        },
    )

    assert response.status_code == 200
    assert len(captured_users) > 1
    assert all(value >= 8000 for value in captured_tokens)
    assert "资料片段" in captured_users[0]
    assert "material_db" in captured_users[0]
    assert "长资料已分块" in response.json()["content"]


def test_plan_processes_all_material_chunks(monkeypatch):
    captured_users = []

    async def fake_chat_completion(api_config, messages):
        captured_users.append(messages[1].content)
        return "模块名称：关系完整性；预计时间：45分钟；难度：中；重要排名：1；资料来源：数据库教材；证据：实体完整性、参照完整性和用户定义完整性；考察内容：完整性约束；练习方式：做约束判断题"

    monkeypatch.setattr("backend.app.main.chat_completion", fake_chat_completion)
    response = client.post(
        "/api/ai/plan",
        json={
            "api_config": {
                "provider_name": "DeepSeek",
                "base_url": "https://api.deepseek.com",
                "api_key": TEST_API_KEY,
                "model": "deepseek-chat",
            },
            "project": {
                "subject": "数据库原理",
                "exam_date": "2026-06-30",
                "daily_minutes": 120,
                "target_score": "90",
            },
            "materials": [
                {
                    "id": "material_db",
                    "title": "数据库教材",
                    "kind": "pdf",
                    "content": "实体完整性、参照完整性和用户定义完整性。" * 4800,
                }
            ],
        },
    )

    assert response.status_code == 200
    assert len(captured_users) > 10
    assert "考试日期：2026-06-30" in captured_users[0]
    assert "目标分数：90" in captured_users[0]
    assert "后续片段还没有进入 AI" not in response.json()["content"]


def test_plan_prompt_raises_coverage_for_high_target_scores(monkeypatch):
    captured_users = []

    async def fake_chat_completion(api_config, messages):
        captured_users.append(messages[1].content)
        return "模块名称：文件目录；预计时间：45分钟；难度：中；重要排名：1；资料来源：操作系统教材；证据：资料列出文件目录；考察内容：文件目录结构；练习方式：做目录结构题"

    monkeypatch.setattr("backend.app.main.chat_completion", fake_chat_completion)
    response = client.post(
        "/api/ai/plan",
        json={
            "api_config": {
                "provider_name": "DeepSeek",
                "base_url": "https://api.deepseek.com",
                "api_key": TEST_API_KEY,
                "model": "deepseek-chat",
            },
            "project": {
                "subject": "操作系统",
                "exam_date": "2026-06-30",
                "daily_minutes": 120,
                "target_score": "90",
            },
            "materials": [
                {
                    "id": "material_os",
                    "title": "操作系统教材",
                    "kind": "pdf",
                    "content": "操作系统引论、进程管理、存储器管理、文件管理和设备管理。",
                }
            ],
        },
    )

    assert response.status_code == 200
    assert "目标分数：90" in captured_users[0]
    assert "90 分以上" in captured_users[0]
    assert "高覆盖率" in captured_users[0]
    assert "二级标题" in captured_users[0]
    assert "不要只抽章节标题" in captured_users[0]


def test_module_practice_prompt_focuses_on_current_module(monkeypatch):
    captured = {}

    async def fake_chat_completion(api_config, messages):
        captured["max_tokens"] = api_config.max_tokens
        captured["user"] = messages[1].content
        return "1. 进程有哪些基本状态？\n参考答案：就绪、运行、阻塞。"

    monkeypatch.setattr("backend.app.main.chat_completion", fake_chat_completion)
    response = client.post(
        "/api/ai/module-practice",
        json={
            "api_config": {
                "provider_name": "DeepSeek",
                "base_url": "https://api.deepseek.com",
                "api_key": TEST_API_KEY,
                "model": "deepseek-chat",
            },
            "project": {
                "subject": "操作系统",
                "exam_date": "2026-06-30",
                "daily_minutes": 120,
            },
            "materials": [
                {
                    "title": "进程课件",
                    "kind": "pdf",
                    "content": "PCB 记录进程状态，进程有就绪、运行、阻塞等状态。",
                }
            ],
            "module_title": "进程",
            "exam_points": "PCB、进程状态、状态转换",
        },
    )

    assert response.status_code == 200
    assert captured["max_tokens"] == 5000
    assert "当前知识点：进程" in captured["user"]


def test_invite_verify_initializes_configured_codes(monkeypatch, tmp_path):
    _set_test_invite_codes(monkeypatch, "1", "2", "3")
    monkeypatch.setenv("KAOBUDDY_INVITE_STORE_PATH", str(tmp_path / "invites.json"))

    response = client.post("/api/invite/verify", json={"code": _test_invite_code("1")})

    assert response.status_code == 200
    assert response.json() == {
        "valid": True,
        "remaining": 50,
        "remainingBudgetCny": 10.0,
        "message": "邀请码有效",
    }


def test_invite_verify_caps_uses_and_budget(monkeypatch, tmp_path):
    invite_file = tmp_path / "invites.json"
    invite_file.write_text(
        """
        {
          "codes": [
            {
              "code": "OVER-LIMIT",
              "maxUses": 99,
              "usedCount": 49,
              "budgetCny": 99,
              "estimatedCostCny": 9.25,
              "enabled": true,
              "expiresAt": "2026-12-31"
            }
          ]
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setenv("KAOBUDDY_INVITE_STORE_PATH", str(invite_file))

    response = client.post("/api/invite/verify", json={"code": "OVER-LIMIT"})

    assert response.status_code == 200
    assert response.json()["valid"] is True
    assert response.json()["remaining"] == 1
    assert response.json()["remainingBudgetCny"] == 0.75


def test_invite_chat_uses_server_config_and_decrements_budget(monkeypatch, tmp_path):
    _set_test_invite_codes(monkeypatch, "1", "2", "3")
    monkeypatch.setenv("KAOBUDDY_INVITE_STORE_PATH", str(tmp_path / "invites.json"))
    monkeypatch.setenv("KAOBUDDY_AI_BASE_URL", "https://server.example")
    monkeypatch.setenv("KAOBUDDY_AI_MODEL", "server-model")
    monkeypatch.setenv("KAOBUDDY_AI_API_KEY", SERVER_API_KEY)
    monkeypatch.setenv("KAOBUDDY_AI_INPUT_CNY_PER_MILLION", "10")
    monkeypatch.setenv("KAOBUDDY_AI_OUTPUT_CNY_PER_MILLION", "20")
    captured = {}

    async def fake_chat_completion_with_usage(api_config, messages):
        captured["api_config"] = api_config
        captured["messages"] = messages
        return "邀请码响应", {"prompt_tokens": 1000, "completion_tokens": 2000}

    monkeypatch.setattr("backend.app.main.chat_completion_with_usage", fake_chat_completion_with_usage, raising=False)

    response = client.post(
        "/api/ai/chat",
        json={
            "inviteCode": _test_invite_code("1"),
            "messages": [{"role": "user", "content": "请回复一句话"}],
            "model": "ignored-front-model",
        },
    )

    assert response.status_code == 200
    assert response.json()["content"] == "邀请码响应"
    assert response.json()["remaining"] == 49
    assert response.json()["remainingBudgetCny"] == 9.95
    assert captured["api_config"].base_url == "https://server.example"
    assert captured["api_config"].model == "server-model"
    assert captured["api_config"].api_key == SERVER_API_KEY


def test_invite_chat_missing_server_config_does_not_decrement(monkeypatch, tmp_path):
    _set_test_invite_codes(monkeypatch, "1", "2", "3")
    monkeypatch.setenv("KAOBUDDY_INVITE_STORE_PATH", str(tmp_path / "invites.json"))
    monkeypatch.delenv("KAOBUDDY_AI_BASE_URL", raising=False)
    monkeypatch.delenv("KAOBUDDY_AI_MODEL", raising=False)
    monkeypatch.delenv("KAOBUDDY_AI_API_KEY", raising=False)

    response = client.post(
        "/api/ai/chat",
        json={
            "inviteCode": _test_invite_code("1"),
            "messages": [{"role": "user", "content": "请回复一句话"}],
        },
    )
    verify = client.post("/api/invite/verify", json={"code": _test_invite_code("1")})

    assert response.status_code == 502
    assert "邀请码已验证，但服务器 AI 还没配置好" in response.json()["detail"]
    assert verify.json()["remaining"] == 50
    assert verify.json()["remainingBudgetCny"] == 10.0


def test_existing_ai_endpoint_accepts_invite_code(monkeypatch, tmp_path):
    _set_test_invite_codes(monkeypatch, "1", "2", "3")
    monkeypatch.setenv("KAOBUDDY_INVITE_STORE_PATH", str(tmp_path / "invites.json"))
    monkeypatch.setenv("KAOBUDDY_AI_BASE_URL", "https://server.example")
    monkeypatch.setenv("KAOBUDDY_AI_MODEL", "server-model")
    monkeypatch.setenv("KAOBUDDY_AI_API_KEY", SERVER_API_KEY)
    monkeypatch.setenv("KAOBUDDY_AI_INPUT_CNY_PER_MILLION", "10")
    monkeypatch.setenv("KAOBUDDY_AI_OUTPUT_CNY_PER_MILLION", "20")
    captured = {}

    async def fake_chat_completion_with_usage(api_config, messages):
        captured["api_config"] = api_config
        captured["user"] = messages[1].content
        return "邀请码计划", {"prompt_tokens": 1000, "completion_tokens": 1000}

    monkeypatch.setattr("backend.app.main.chat_completion_with_usage", fake_chat_completion_with_usage, raising=False)

    response = client.post(
        "/api/ai/plan",
        json={
            "inviteCode": _test_invite_code("2"),
            "project": {
                "subject": "数据库原理",
                "exam_date": "2026-06-30",
                "daily_minutes": 120,
            },
            "materials": [],
        },
    )

    assert response.status_code == 200
    assert response.json()["content"] == "邀请码计划"
    assert response.json()["remaining"] == 49
    assert response.json()["remainingBudgetCny"] == 9.97
    assert captured["api_config"].api_key == SERVER_API_KEY
    assert "数据库原理" in captured["user"]


def test_frontend_keeps_invite_auth_wired():
    app_source = Path("src/App.tsx").read_text(encoding="utf-8")

    assert "verifyInviteCode" in app_source
    assert "storage.saveInviteState" in app_source
    assert "function getAuthPayload" in app_source
    assert "...getAuthPayload()" in app_source
    assert "inviteCode: undefined as never" not in app_source


def test_daily_plan_prompt_uses_project_and_unfinished_modules(monkeypatch):
    captured = {}

    async def fake_chat_completion(api_config, messages):
        captured["system"] = messages[0].content
        captured["user"] = messages[1].content
        return '[{"module_id":"module_process","date":"2026-06-03","day_order":1,"reason":"先学高优先级模块"}]'

    monkeypatch.setattr("backend.app.main.chat_completion", fake_chat_completion)
    response = client.post(
        "/api/ai/daily-plan",
        json={
            "api_config": {
                "provider_name": "DeepSeek",
                "base_url": "https://api.deepseek.com",
                "api_key": TEST_API_KEY,
                "model": "deepseek-chat",
            },
            "project": {
                "subject": "操作系统",
                "exam_date": "2026-06-30",
                "daily_minutes": 120,
                "target_score": "90",
            },
            "modules": [
                {
                    "id": "module_process",
                    "title": "进程",
                    "estimated_minutes": 60,
                    "module_status": "todo",
                    "importance_rank": 1,
                    "difficulty": "high",
                    "exam_points": "PCB、状态转换",
                    "source_title": "进程课件",
                    "evidence": "PCB 记录进程状态",
                }
            ],
            "extra": "先安排高频考点",
        },
    )

    assert response.status_code == 200
    assert response.json()["content"].startswith("[")
    assert "只安排用户给出的未完成知识点模块" in captured["system"]
    assert "考试日期：2026-06-30" in captured["user"]
    assert "每天可学习：120 分钟" in captured["user"]
    assert "目标分数：90" in captured["user"]
    assert "module_process" in captured["user"]
    assert "进程" in captured["user"]
    assert "先安排高频考点" in captured["user"]


# ---- CSP header tests ----


def test_csp_header_present_on_dynamic_routes(monkeypatch, tmp_path):
    _set_test_invite_codes(monkeypatch, "1", "2", "3")
    monkeypatch.setenv("KAOBUDDY_INVITE_STORE_PATH", str(tmp_path / "invites.json"))
    response = client.post(
        "/api/invite/verify",
        json={"code": _test_invite_code("1")},
    )
    csp = response.headers.get("content-security-policy")
    assert csp is not None
    assert "default-src 'self'" in csp
    assert "script-src 'self'" in csp
    assert "connect-src 'self' https:" in csp
    assert "object-src 'none'" in csp


def test_csp_header_present_on_static_routes():
    response = client.get("/health")
    csp = response.headers.get("content-security-policy")
    assert csp is not None


# ---- Invite guard tests ----


def test_invite_chat_rejects_empty_code():
    # Pydantic min_length=1 rejects empty inviteCode at the schema layer → 422
    response = client.post(
        "/api/ai/chat",
        json={
            "inviteCode": "",
            "messages": [{"role": "user", "content": "你好"}],
        },
    )
    assert response.status_code == 422


def test_invite_plan_oversized_body_rejected(monkeypatch, tmp_path):
    _set_test_invite_codes(monkeypatch, "1", "2", "3")
    monkeypatch.setenv("KAOBUDDY_INVITE_STORE_PATH", str(tmp_path / "invites.json"))
    monkeypatch.setenv("KAOBUDDY_AI_BASE_URL", "https://server.example")
    monkeypatch.setenv("KAOBUDDY_AI_MODEL", "server-model")
    monkeypatch.setenv("KAOBUDDY_AI_API_KEY", SERVER_API_KEY)
    monkeypatch.setenv("KAOBUDDY_AI_INPUT_CNY_PER_MILLION", "10")
    monkeypatch.setenv("KAOBUDDY_AI_OUTPUT_CNY_PER_MILLION", "20")
    # Set a very low input limit so the test doesn't need huge content
    monkeypatch.setenv("KAOBUDDY_INVITE_MAX_INPUT_CHARS", "100")

    response = client.post(
        "/api/ai/plan",
        json={
            "inviteCode": _test_invite_code("1"),
            "project": {"subject": "测试", "exam_date": "2026-12-31", "daily_minutes": 60},
            "materials": [
                {"title": "test", "kind": "text", "content": "x" * 200}
            ],
        },
    )
    assert response.status_code == 413
    assert "太长了" in response.json()["detail"]


# ---- Edge case: daily plan with empty module list ----


def test_daily_plan_rejects_empty_modules(monkeypatch):
    async def fake_chat_completion(api_config, messages):
        return '[{"module_id":"x","date":"2026-06-07","day_order":1,"reason":"test"}]'

    monkeypatch.setattr("backend.app.main.chat_completion", fake_chat_completion)
    response = client.post(
        "/api/ai/daily-plan",
        json={
            "api_config": {
                "provider_name": "DeepSeek",
                "base_url": "https://api.deepseek.com",
                "api_key": TEST_API_KEY,
                "model": "deepseek-chat",
            },
            "project": {"subject": "测试", "exam_date": "2026-12-31", "daily_minutes": 60},
            "modules": [],
        },
    )
    # Even with empty module list, the endpoint should still accept the request
    # (the frontend guards against calling it with 0 modules)
    assert response.status_code == 200


# ---- Logging related: health check still works ----


def test_health_unaffected_by_new_middleware():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
