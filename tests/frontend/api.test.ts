import assert from "node:assert/strict";
import test from "node:test";
import { parseApiResponse } from "../../src/api.ts";

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
