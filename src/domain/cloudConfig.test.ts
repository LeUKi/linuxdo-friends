import { describe, expect, it } from "vitest";
import {
  buildBrowserCodeAuthStartUrl,
  cloudConfigSlotUrl,
  parseCloudAuthExchangePayload,
  sanitizeCloudErrorMessage,
  summarizeCloudConfigPayload
} from "./cloudConfig";

describe("cloud config helpers", () => {
  it("builds the browser-code cloud auth start URL", () => {
    const url = new URL(buildBrowserCodeAuthStartUrl("challenge-value"));

    expect(url.origin).toBe("https://linuxdo-cloud-save.lafish.workers.dev");
    expect(url.pathname).toBe("/auth/start");
    expect(url.searchParams.get("app")).toBe("linuxdo-friends");
    expect(url.searchParams.get("flow")).toBe("browser_code");
    expect(url.searchParams.get("challenge")).toBe("challenge-value");
  });

  it("builds the config slot URL", () => {
    expect(cloudConfigSlotUrl()).toBe("https://linuxdo-cloud-save.lafish.workers.dev/api/apps/linuxdo-friends/slots/config");
  });

  it("parses valid cloud auth exchange payloads", () => {
    const result = parseCloudAuthExchangePayload({
      token: "jwt-token",
      token_type: "Bearer",
      token_kind: "jwt",
      app: "linuxdo-friends",
      linux_do_id: "42"
    });

    expect(result).toEqual({
      app: "linuxdo-friends",
      linuxDoId: "42",
      token: "jwt-token",
      tokenKind: "jwt",
      tokenType: "Bearer"
    });
  });

  it("rejects invalid cloud auth exchange payloads without leaking the token", () => {
    const payload = {
      token: "secret-token",
      token_type: "Bearer",
      token_kind: "jwt",
      app: "wrong",
      linux_do_id: "42"
    };

    expect(() => parseCloudAuthExchangePayload(payload)).toThrow("云存档登录来源不正确。");
    try {
      parseCloudAuthExchangePayload(payload);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("secret-token");
    }
  });

  it("rejects missing or mismatched exchange metadata", () => {
    expect(() => parseCloudAuthExchangePayload({ token_type: "Bearer", token_kind: "jwt", app: "linuxdo-friends", linux_do_id: "42" })).toThrow(
      "云存档登录缺少凭证。"
    );
    expect(() => parseCloudAuthExchangePayload({ token: "x", token_type: "Basic", token_kind: "jwt", app: "linuxdo-friends", linux_do_id: "42" })).toThrow(
      "云存档登录凭证类型不正确。"
    );
    expect(() => parseCloudAuthExchangePayload({ token: "x", token_type: "Bearer", token_kind: "opaque", app: "linuxdo-friends", linux_do_id: "42" })).toThrow(
      "云存档登录凭证格式不正确。"
    );
    expect(() => parseCloudAuthExchangePayload({ token: "x", token_type: "Bearer", token_kind: "jwt", app: "linuxdo-friends" })).toThrow(
      "云存档登录缺少账号标识。"
    );
  });

  it("summarizes valid cloud config payloads through the config-transfer boundary", () => {
    const status = summarizeCloudConfigPayload(configPayload(), "2026-06-29T00:01:00.000Z");

    expect(status).toEqual({
      state: "remote_config",
      checkedAt: "2026-06-29T00:01:00.000Z",
      exportedAt: "2026-06-29T00:00:00.000Z",
      friendCount: 1,
      requestStatsTotal: 0
    });
  });

  it("summarizes worker slot config envelopes through the config-transfer boundary", () => {
    const status = summarizeCloudConfigPayload(
      {
        found: true,
        app: "linuxdo-friends",
        slot: "config",
        data: configPayload(),
        version: 2,
        updatedAt: "2026-06-29T00:02:00.000Z"
      },
      "2026-06-29T00:03:00.000Z"
    );

    expect(status).toEqual({
      state: "remote_config",
      checkedAt: "2026-06-29T00:03:00.000Z",
      exportedAt: "2026-06-29T00:00:00.000Z",
      friendCount: 1,
      requestStatsTotal: 0
    });
  });

  it("reports missing worker slot config envelopes as missing config", () => {
    const status = summarizeCloudConfigPayload(
      { found: false, app: "linuxdo-friends", slot: "config", data: null, version: 0, updatedAt: null },
      "2026-06-29T00:03:00.000Z"
    );

    expect(status).toEqual({
      state: "missing",
      checkedAt: "2026-06-29T00:03:00.000Z",
      message: "云端还没有配置备份。"
    });
  });

  it("rejects invalid cloud config payloads", () => {
    expect(() => summarizeCloudConfigPayload({ source: "linuxdo-friends" })).toThrow("配置文件版本不支持。");
    expect(() => summarizeCloudConfigPayload({ found: true, app: "linuxdo-friends", slot: "config", data: null, version: 1, updatedAt: "now" })).toThrow(
      "云端配置格式不正确。"
    );
    expect(() => summarizeCloudConfigPayload("bad")).toThrow("云端配置不是有效的 JSON 对象。");
  });

  it("redacts tokens, authorization headers, and URLs from cloud errors", () => {
    expect(
      sanitizeCloudErrorMessage(
        "failed https://example.com/callback?token=secret-token Authorization: Bearer abc.def token=another code=secret-code verifier=secret-verifier"
      )
    ).toBe("failed [redacted-url] Authorization: Bearer <redacted> token=<redacted> code=<redacted> verifier=<redacted>");
  });
});

function configPayload() {
  return {
    schemaVersion: 1,
    source: "linuxdo-friends",
    exportedAt: "2026-06-29T00:00:00.000Z",
    friends: {
      neo: {
        username: "neo",
        groups: [],
        upgradedAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z"
      }
    },
    settings: { refreshIntervalMinutes: 60 }
  };
}
