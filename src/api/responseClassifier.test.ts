import { describe, expect, it } from "vitest";
import { classifyFetchResponse, looksLikeChallengeHtml } from "./responseClassifier";

describe("response classifier", () => {
  it("classifies 403 as blocked", async () => {
    const result = await classifyFetchResponse(new Response("no", { status: 403 }));
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("classifies 429 as rate limited", async () => {
    const result = await classifyFetchResponse(new Response("slow", { status: 429 }));
    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("parses valid JSON", async () => {
    const result = await classifyFetchResponse(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(result).toMatchObject({ ok: true, json: { ok: true } });
  });

  it("accepts the real user-actions payload when an excerpt quotes a Cloudflare page", async () => {
    const payload = {
      user_actions: [
        {
          action_type: 4,
          topic_id: 2761192,
          acting_username: "lafish",
          title: "LDC 的分发接口似乎套了人机验证，可用性降级",
          excerpt:
            "我的后端服务调用分发接口，会触发人机验证，可能是近期出现的。 \n接入的是 “易支付兼容接口”，响应结果： \n{\n  &quot;httpStatus&quot;: 403,\n  &quot;body&quot;: &quot;&lt;html dir=\\&quot;ltr\\&quot;&gt;\\n&lt;head&gt;\\n    &lt;title&gt;Just a moment...&lt;/title&gt;\\n    &lt;meta http-equiv=\\&quot;Content-Type\\&quot; content=\\&quot;text/html; charset=utf-8\\&quot;&gt;\\n    &lt;meta name=\\&quot;viewport\\&quot; content=\\&quot;width=device-width, initial-scal&hellip;"
        }
      ]
    };
    const result = await classifyFetchResponse(jsonResponse(payload));

    expect(result).toEqual({ ok: true, json: payload });
  });

  it.each(["cf-mitigated", "Just a moment", "challenge-error-text", "Enable JavaScript and cookies"])(
    "does not classify valid JSON containing %s as a challenge",
    async (value) => {
      const result = await classifyFetchResponse(jsonResponse({ excerpt: value }));
      expect(result).toEqual({ ok: true, json: { excerpt: value } });
    }
  );

  it.each([200, 403, 429])("classifies real challenge HTML returned with status %i", async (status) => {
    const result = await classifyFetchResponse(challengeResponse(status));
    expect(result).toMatchObject({ ok: false, reason: "challenge" });
  });

  it("classifies the Cloudflare mitigation response header independently", async () => {
    const result = await classifyFetchResponse(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", "cf-mitigated": "challenge" }
      })
    );
    expect(result).toMatchObject({ ok: false, reason: "challenge" });
  });

  it("does not classify non-HTML challenge text as a challenge", async () => {
    expect(looksLikeChallengeHtml("Just a moment", "text/plain")).toBe(false);
    const result = await classifyFetchResponse(new Response("Just a moment", { status: 429 }));
    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("keeps non-challenge HTML and invalid JSON as invalid responses", async () => {
    await expect(classifyFetchResponse(new Response("<html><title>linux.do</title></html>", { status: 200, headers: { "content-type": "text/html" } }))).resolves.toMatchObject({
      ok: false,
      reason: "invalid_response"
    });
    await expect(classifyFetchResponse(new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }))).resolves.toMatchObject({
      ok: false,
      reason: "invalid_response"
    });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function challengeResponse(status: number): Response {
  return new Response("<!doctype html><html><head><title>Just a moment...</title></head><body><span id='challenge-error-text'>Enable JavaScript and cookies to continue</span></body></html>", {
    status,
    headers: { "content-type": "text/html; charset=UTF-8" }
  });
}
