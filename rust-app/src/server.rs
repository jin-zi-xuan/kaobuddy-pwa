use std::{collections::HashSet, env, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::DefaultBodyLimit,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tower_http::{
    cors::{Any, CorsLayer},
    set_header::SetResponseHeaderLayer,
};

use crate::bilibili;

const MAX_BODY_BYTES: usize = 12 * 1024 * 1024;

#[derive(Debug, Serialize)]
struct Health {
    ok: bool,
}

#[derive(Debug, Deserialize)]
struct InviteRequest {
    code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InviteResponse {
    valid: bool,
    remaining: u32,
    remaining_budget_cny: f64,
    message: String,
}

#[derive(Debug, Deserialize)]
struct VideoRequest {
    url: String,
}

#[derive(Debug, Serialize)]
struct VideoResponse {
    title: String,
    description: String,
    subtitles: String,
    source_url: String,
    warnings: Vec<String>,
    metadata: Value,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn upstream(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "detail": self.message }))).into_response()
    }
}

pub fn api_router() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/manifest.webmanifest", get(manifest))
        .route("/sw.js", get(service_worker))
        .route("/register-sw.js", get(register_service_worker))
        .route("/icons/icon.svg", get(app_icon))
        .route("/api/invite/verify", post(verify_invite))
        .route("/api/video/import", post(import_video))
        .route("/api/ai/test", post(ai_test))
        .route("/api/ai/chat", post(ai_chat))
        .route("/api/ai/plan", post(ai_plan))
        .route("/api/ai/daily-plan", post(ai_daily_plan))
        .route("/api/ai/memorize", post(ai_memorize))
        .route("/api/ai/teach", post(ai_teach))
        .route("/api/ai/cards", post(ai_cards))
        .route("/api/ai/cards/stream", post(ai_cards_stream))
        .route("/api/ai/practice", post(ai_practice))
        .route("/api/ai/module-practice", post(ai_module_practice))
        .route("/api/ai/grade-practice", post(ai_grade_practice))
        .route("/api/ai/mock-exam", post(ai_mock_exam))
        .route("/api/ai/grade-mock", post(ai_grade_mock))
        .route("/api/ocr/handwriting", post(ocr_handwriting))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
}

async fn manifest() -> Response {
    static_response(
        "application/manifest+json; charset=utf-8",
        include_str!("../assets/manifest.webmanifest"),
    )
}

async fn service_worker() -> Response {
    static_response(
        "application/javascript; charset=utf-8",
        include_str!("../assets/sw.js"),
    )
}

async fn register_service_worker() -> Response {
    static_response(
        "application/javascript; charset=utf-8",
        include_str!("../assets/register-sw.js"),
    )
}

async fn app_icon() -> Response {
    static_response(
        "image/svg+xml; charset=utf-8",
        include_str!("../assets/icons/icon.svg"),
    )
}

fn static_response(content_type: &'static str, body: &'static str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .body(Body::from(body))
        .expect("static response headers are valid")
}

pub fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_headers(Any)
        .allow_methods(Any)
}

pub fn security_headers() -> SetResponseHeaderLayer<HeaderValue> {
    SetResponseHeaderLayer::if_not_present(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; frame-src https://player.bilibili.com; media-src 'self' https: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'",
        ),
    )
}

async fn health() -> Json<Health> {
    Json(Health { ok: true })
}

async fn verify_invite(Json(request): Json<InviteRequest>) -> Json<InviteResponse> {
    let configured: HashSet<String> = env::var("KAOBUDDY_INVITE_CODES")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .map(str::to_owned)
        .collect();
    let valid = configured.contains(request.code.trim());
    Json(InviteResponse {
        valid,
        remaining: if valid { 50 } else { 0 },
        remaining_budget_cny: if valid { 10.0 } else { 0.0 },
        message: if valid {
            "邀请码可用，可以开始学习。".into()
        } else {
            "邀请码无效或服务端未配置，请使用自己的 API Key。".into()
        },
    })
}

async fn import_video(Json(request): Json<VideoRequest>) -> Result<Json<VideoResponse>, ApiError> {
    let parsed = url::Url::parse(request.url.trim())
        .map_err(|_| ApiError::bad_request("请粘贴完整的视频链接。"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ApiError::bad_request("视频链接必须使用 http 或 https。"));
    }

    let client = http_client()?;
    let response = client
        .get(parsed)
        .header(header::USER_AGENT, "Mozilla/5.0 KaoBuddy/2.0")
        .header(header::REFERER, "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|error| ApiError::upstream(format!("视频页面读取失败：{error}")))?;
    let final_url = response.url().to_string();
    let html = response
        .error_for_status()
        .map_err(|error| ApiError::upstream(format!("视频页面返回异常：{error}")))?
        .text()
        .await
        .map_err(|error| ApiError::upstream(format!("视频页面解析失败：{error}")))?;

    let document = Html::parse_document(&html);
    let title = meta_content(&document, "property", "og:title")
        .or_else(|| meta_content(&document, "name", "title"))
        .or_else(|| {
            Selector::parse("title").ok().and_then(|selector| {
                document
                    .select(&selector)
                    .next()
                    .map(|node| node.text().collect::<String>().trim().to_owned())
            })
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "B 站学习视频".into());
    let description = meta_content(&document, "name", "description")
        .or_else(|| meta_content(&document, "property", "og:description"))
        .unwrap_or_default();
    let embed_url = bilibili::embed_url(&final_url).or_else(|| bilibili::embed_url(&request.url));

    let mut warnings = Vec::new();
    if embed_url.is_none() {
        warnings.push("没有识别出 BV/AV 号，暂时不能在应用内播放。".into());
    }
    warnings.push("公开视频字幕仍按 best-effort 读取；没有公开字幕时可粘贴课程笔记。".into());

    Ok(Json(VideoResponse {
        title,
        description,
        subtitles: String::new(),
        source_url: final_url,
        warnings,
        metadata: json!({ "embed_url": embed_url }),
    }))
}

fn meta_content(document: &Html, attr: &str, value: &str) -> Option<String> {
    let selector = Selector::parse(&format!("meta[{attr}=\"{value}\"]")).ok()?;
    document
        .select(&selector)
        .next()
        .and_then(|node| node.value().attr("content"))
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .map(str::to_owned)
}

async fn ai_test(Json(payload): Json<Value>) -> Result<Json<Value>, ApiError> {
    call_ai(payload, "只回复：连接成功").await.map(Json)
}

async fn ai_chat(Json(payload): Json<Value>) -> Result<Json<Value>, ApiError> {
    call_ai(
        payload,
        "你是 KaoBuddy 考研搭子，请直接、可靠地帮助用户推进学习。",
    )
    .await
    .map(Json)
}

macro_rules! ai_handler {
    ($name:ident, $prompt:literal) => {
        async fn $name(Json(payload): Json<Value>) -> Result<Json<Value>, ApiError> {
            call_ai(payload, $prompt).await.map(Json)
        }
    };
}

ai_handler!(
    ai_plan,
    "根据考试日期、每日时间、目标分数和导入资料，拆成可执行的考研知识模块。输出清晰的 JSON 或结构化文本。"
);
ai_handler!(
    ai_daily_plan,
    "把知识模块安排到每天，控制总时长，优先高频考点，并说明今天的第一步。"
);
ai_handler!(
    ai_memorize,
    "生成考前速背内容：核心概念、必背要点、记忆提示、常见考法和易错提醒。"
);
ai_handler!(
    ai_teach,
    "围绕指定知识点，从直觉、定义、原理、例题到易错点进行讲解。"
);
ai_handler!(
    ai_cards,
    "围绕指定知识点生成 4-6 张学习卡片，返回 JSON 数组，包含 concept、mistake、exam、quick_memory 类型。"
);
ai_handler!(
    ai_practice,
    "根据资料生成或批改练习题，给出参考答案、解析与薄弱项提醒。"
);
ai_handler!(
    ai_module_practice,
    "只围绕当前知识点生成 3 道模块内模拟题，附参考答案和完整解析。"
);
ai_handler!(
    ai_grade_practice,
    "逐题批改练习，给出对错、错因、正确答案和整体评价。"
);
ai_handler!(
    ai_mock_exam,
    "严格根据资料生成指定时长的考研模拟卷，题目与答案分区展示。"
);
ai_handler!(
    ai_grade_mock,
    "逐题评分模拟考试，按得分点给分，最后总结总分、正确率和薄弱知识点。"
);
ai_handler!(
    ocr_handwriting,
    "识别图片中的手写学习笔记，按原顺序转写，不确定内容用方括号标记。"
);

async fn ai_cards_stream(Json(payload): Json<Value>) -> Result<Response, ApiError> {
    let result = call_ai(
        payload,
        "围绕指定知识点生成 4-6 张学习卡片，返回 JSON 数组。",
    )
    .await?;
    let content = result
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let event = format!(
        "data: {}\n\ndata: [DONE]\n\n",
        serde_json::to_string(&json!({ "t": content })).unwrap_or_default()
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from(event))
        .map_err(|error| ApiError::upstream(error.to_string()))
}

async fn call_ai(payload: Value, system_prompt: &str) -> Result<Value, ApiError> {
    let config = payload
        .get("api_config")
        .or_else(|| payload.get("apiConfig"));
    let base_url = value_or_env(config, "base_url", "KAOBUDDY_AI_BASE_URL")?;
    let api_key = value_or_env(config, "api_key", "KAOBUDDY_AI_API_KEY")?;
    let model = value_or_env(config, "model", "KAOBUDDY_AI_MODEL")?;
    let endpoint = if base_url.ends_with("/chat/completions") {
        base_url
    } else {
        format!("{}/chat/completions", base_url.trim_end_matches('/'))
    };

    let messages = payload
        .get("messages")
        .cloned()
        .filter(Value::is_array)
        .unwrap_or_else(|| {
            let context = serde_json::to_string_pretty(&payload).unwrap_or_default();
            json!([
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": context }
            ])
        });
    let body = json!({
        "model": model,
        "messages": messages,
        "temperature": config.and_then(|value| value.get("temperature")).and_then(Value::as_f64).unwrap_or(0.4),
        "max_tokens": config.and_then(|value| value.get("max_tokens")).and_then(Value::as_u64).unwrap_or(4000)
    });

    let response = http_client()?
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| ApiError::upstream(format!("AI 请求失败：{error}")))?;
    let status = response.status();
    let response_json: Value = response
        .json()
        .await
        .map_err(|error| ApiError::upstream(format!("AI 返回无法解析：{error}")))?;
    if !status.is_success() {
        return Err(ApiError::upstream(
            response_json
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("AI 服务返回错误")
                .to_owned(),
        ));
    }
    let content = response_json
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Ok(json!({ "content": content }))
}

fn value_or_env(config: Option<&Value>, key: &str, env_key: &str) -> Result<String, ApiError> {
    config
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            env::var(env_key)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .ok_or_else(|| ApiError::bad_request(format!("缺少 AI 配置：{key}")))
}

fn http_client() -> Result<Client, ApiError> {
    Client::builder()
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|error| ApiError::upstream(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_is_compatible_with_the_legacy_probe() {
        let Json(health) = health().await;
        assert!(health.ok);
    }

    #[tokio::test]
    async fn unknown_invite_is_rejected() {
        let Json(result) = verify_invite(Json(InviteRequest {
            code: "not-configured".into(),
        }))
        .await;
        assert!(!result.valid);
    }
}
