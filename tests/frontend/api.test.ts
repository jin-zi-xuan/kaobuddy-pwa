import assert from "node:assert/strict";
import test from "node:test";
import { DEEPSEEK_IMAGE_UNSUPPORTED_MESSAGE, assertImageRecognitionSupported, isDeepSeekApiConfig, parseApiResponse } from "../../src/api.ts";

test("non-json API failures explain that the local backend may be offline", async () => {
  const response = new Response("", {
    status: 500,
    headers: { "Content-Type": "text/plain" },
  });

  await assert.rejects(
    () => parseApiResponse(response),
    /本地后端可能没有启动/
  );
});

test("DeepSeek custom API config is detected as not supporting image recognition", () => {
  const deepseekConfig = {
    provider_name: "DeepSeek",
    base_url: "https://api.deepseek.com",
    api_key: "TEST_ONLY_API_KEY",
    model: "deepseek-v4-pro",
    temperature: 0.4,
    max_tokens: 1800
  };
  const openaiConfig = {
    ...deepseekConfig,
    provider_name: "OpenAI",
    base_url: "https://api.openai.com/v1",
    model: "gpt-5.5"
  };

  assert.equal(isDeepSeekApiConfig(deepseekConfig), true);
  assert.equal(isDeepSeekApiConfig(openaiConfig), false);
  assert.throws(
    () => assertImageRecognitionSupported({ api_config: deepseekConfig }),
    new RegExp(DEEPSEEK_IMAGE_UNSUPPORTED_MESSAGE)
  );
  assert.doesNotThrow(() => assertImageRecognitionSupported({ api_config: openaiConfig }));
  assert.doesNotThrow(() => assertImageRecognitionSupported({ inviteCode: "TEST_ONLY_INVITE" }));
});
