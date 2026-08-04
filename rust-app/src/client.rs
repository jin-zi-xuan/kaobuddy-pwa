use crate::models::AppData;

#[cfg(feature = "web")]
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

#[cfg(not(feature = "web"))]
pub async fn call_ai(_path: &str, _data: &AppData, _instruction: &str) -> Result<String, String> {
    Err("AI 操作需要在浏览器中执行。".into())
}
