use crate::models::AppData;

#[cfg(feature = "desktop")]
fn system_prompt(path: &str) -> &'static str {
    match path {
        "/api/ai/test" => "只回复：连接成功",
        "/api/ai/plan" => "根据考试日期、每日时间、目标分数和导入资料，拆成可执行的考研知识模块。",
        "/api/ai/mock-exam" => "严格根据资料生成指定时长的考研模拟卷，题目与答案分区展示。",
        _ => "你是 KaoBuddy 考研搭子，请直接、可靠地帮助用户推进学习。",
    }
}

#[cfg(feature = "desktop")]
pub async fn call_ai(path: &str, data: &AppData, instruction: &str) -> Result<String, String> {
    use serde_json::{Value, json};

    let api = &data.api;
    if api.base_url.trim().is_empty() {
        return Err("缺少 AI 配置：base_url".into());
    }
    if api.api_key.trim().is_empty() {
        return Err("缺少 AI 配置：api_key".into());
    }
    if api.model.trim().is_empty() {
        return Err("缺少 AI 配置：model".into());
    }
    let endpoint = if api.base_url.ends_with("/chat/completions") {
        api.base_url.clone()
    } else {
        format!("{}/chat/completions", api.base_url.trim_end_matches('/'))
    };
    let context = serde_json::to_string_pretty(&json!({
        "project": data.project,
        "materials": data.materials,
        "modules": data.modules,
        "instruction": instruction,
    }))
    .unwrap_or_default();
    let body = json!({
        "model": api.model,
        "messages": [
            { "role": "system", "content": system_prompt(path) },
            { "role": "user", "content": context }
        ],
        "temperature": 0.4,
        "max_tokens": 4000
    });
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|error| format!("AI 客户端创建失败：{error}"))?
        .post(endpoint)
        .bearer_auth(api.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI 请求失败：{error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("AI 返回无法解析：{error}"))?;
    if !status.is_success() {
        return Err(body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("AI 服务返回错误")
            .to_owned());
    }
    Ok(body
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned())
}

#[cfg(all(feature = "web", not(feature = "desktop")))]
pub async fn call_ai(path: &str, data: &AppData, instruction: &str) -> Result<String, String> {
    use gloo_net::http::Request;
    use serde_json::{Value, json};

    let payload = json!({
        "api_config": data.api,
        "project": data.project,
        "materials": data.materials,
        "modules": data.modules,
        "instruction": instruction,
    });
    let response = Request::post(path)
        .json(&payload)
        .map_err(|error| format!("请求无法创建：{error}"))?
        .send()
        .await
        .map_err(|error| format!("无法连接 KaoBuddy 服务：{error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("服务返回无法解析：{error}"))?;
    if !(200..300).contains(&status) {
        return Err(body
            .get("error")
            .or_else(|| body.get("message"))
            .or_else(|| body.get("detail"))
            .and_then(Value::as_str)
            .unwrap_or("AI 服务返回错误")
            .to_owned());
    }
    Ok(body
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("连接成功")
        .to_owned())
}

#[cfg(not(any(feature = "web", feature = "desktop")))]
pub async fn call_ai(_path: &str, _data: &AppData, _instruction: &str) -> Result<String, String> {
    Err("AI 操作需要在浏览器中执行。".into())
}
