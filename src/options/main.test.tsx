import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addFriendFromKnownUser, addFriendFromProfile, removeFriend, updateFriend } from "../domain/friends";
import { removeDredgeRule, upsertDredgeRule } from "../domain/laoFinds";
import { defaultAppState } from "../domain/defaultState";
import { recordRequestAttempts } from "../domain/requestStats";
import { DATA_CONSENT_PERMISSIONS, DATA_CONSENT_REQUIRED_MESSAGE } from "../shared/dataConsent";
import type { AppState, CloudArchiveLocalStateResult, DredgeRule } from "../shared/types";
import { resetAppStateObserverForTest, resetRuntimeObserversForTest } from "../state/atoms";
import { APP_STATE_STORAGE_KEY } from "../storage/storage";
import { SITE_DATA_PROGRESS_STORAGE_KEY } from "../storage/siteDataProgressStorage";
import { createMockStorage } from "../test/mockStorage";
import { OptionsApp } from "./main";

describe("OptionsApp update diagnostics", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetAppStateObserverForTest();
    resetRuntimeObserversForTest();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.pushState(null, "", "/");
  });

  it("shows the installed version and highlights a newer latest release", async () => {
    const chromeMock = setupChrome({
      updateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "update-available",
        latestVersion: "1.1.0",
        checkedAt: "2026-06-28T00:00:00.000Z",
        source: "github_release"
      }
    });
    const { container } = await renderOptionsApp();

    expect(container.querySelector(".version-current")?.textContent).toBe("v1.0.0");
    expect(container.querySelector<HTMLAnchorElement>(".version-github-link")?.href).toBe("https://github.com/LeUKi/linuxdo-friends");
    expect(container.querySelector(".version-update-link")?.textContent).toContain("新 v1.1.0");
    expect(container.textContent).toContain("发现新版本");
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "checkForUpdates", force: undefined });
  });

  it("shows update-check diagnostics on the options page", async () => {
    setupChrome({
      updateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "error",
        checkedAt: "2026-06-28T00:00:00.000Z",
        error: "GitHub Release 检查失败：HTTP 403",
        source: "github_release"
      }
    });
    const { container } = await renderOptionsApp();

    expect(container.textContent).toContain("检查失败");
    expect(container.textContent).toContain("GitHub Release 检查失败：HTTP 403");
  });

  it("forces an update check from the options page", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "检查更新").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "checkForUpdates", force: true });
  });

  it("does not check GitHub when Firefox update consent is denied", async () => {
    const chromeMock = setupChrome({ firefoxDataPermissionRequest: false });
    const { container } = await renderOptionsApp();
    chromeMock.sendMessage.mockClear();

    await act(async () => {
      getButton(container, "检查更新").click();
      await Promise.resolve();
    });

    expect(chromeMock.permissionsRequest).toHaveBeenCalledWith({ data_collection: DATA_CONSENT_PERMISSIONS.updateCheck });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "checkForUpdates", force: true });
    expect(container.textContent).toContain(DATA_CONSENT_REQUIRED_MESSAGE);
  });

  it("identifies the current account from the options page", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "重新探测").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "identifyCurrentAccount" });
  });

  it("shows a loading state while probing the local account", async () => {
    const identify = createPendingIdentifyResponse();
    const chromeMock = setupChrome({ identifyResponse: identify.promise });
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "重新探测").click();
    });

    expect(getButton(container, "探测中").disabled).toBe(true);
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "identifyCurrentAccount" });

    await act(async () => {
      identify.resolve();
      await Promise.resolve();
    });

    expect(getButton(container, "重新探测").disabled).toBe(false);
  });


  it("clears cache without confirmation from the options page", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp("#data");

    await act(async () => {
      getButton(container, "清理缓存").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "clearCache" });
  });

  it("fully resets only after confirmation from the options page", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp("#data");

    await act(async () => {
      getButton(container, "全量重置").click();
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "resetExtension" });
  });

  it("exports config from the options page", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:config");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp("#data");

    await act(async () => {
      getButton(container, "导出配置").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "exportConfig" });
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:config");
    expect(container.textContent).toContain("已导出 1 位佬朋友配置。");
    const migrationCard = headingByText(container, "配置迁移").closest<HTMLElement>(".settings-card");
    const disclosure = getDataDisclosure(migrationCard);
    expect(disclosure.textContent).toContain("数据说明");
    expect(disclosure.textContent).toContain("好友备注默认保存在本地，导出配置时会随佬朋友配置迁移");
    expect(disclosure.textContent).toContain("导出的 JSON 可能包含 Telegram Bot Token / Chat ID");
    expect(disclosure.textContent).toContain("账号登录状态、动态内容和头像缓存不会导出");
    expect(disclosure.textContent).toContain("请把导出文件作为私密备份保存");
    expect(migrationCard?.textContent).not.toContain("已配置的 Telegram Bot Token / Chat ID 也会随配置迁移");
  });

  it("imports config from the options page after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp("#data");
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("import input not found");
    const file = new File(["{}"], "config.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "importConfig", json: "{}" });
    expect(container.textContent).toContain("已导入 1 位佬朋友配置。");
  });

  it("defaults to the basic section and canonicalizes an empty hash", async () => {
    const { container } = await renderOptionsApp();

    expect(window.location.hash).toBe("#basic");
    expect(getButton(container, "基础").classList.contains("active")).toBe(true);
    expect(Array.from(container.querySelectorAll(".options-nav button")).map((button) => button.textContent)).toEqual([
      "基础",
      "视奸范围",
      "佬料打捞",
      "新料通知",
      "请求统计",
      "数据管理",
      "赞助"
    ]);
    expect(container.textContent).toContain("本地账号探测");
    expect(container.textContent).toContain("动态跳转");
    const activityLinkCard = headingByText(container, "动态跳转").closest<HTMLElement>(".settings-card");
    expect(activityLinkCard?.querySelector(".settings-card-actions .segmented-control")?.textContent).toContain("页内跳转");
  });

  it("canonicalizes unknown hashes back to the basic section", async () => {
    const { container } = await renderOptionsApp("#unknown");

    expect(window.location.hash).toBe("#basic");
    expect(getButton(container, "基础").classList.contains("active")).toBe(true);
  });

  it("keeps explicit legacy option hashes compatible with the new sections", async () => {
    const friendsRender = await renderOptionsApp("#friends");

    expect(window.location.hash).toBe("#scope");
    expect(getButton(friendsRender.container, "视奸范围").classList.contains("active")).toBe(true);

    act(() => {
      friendsRender.root.unmount();
    });
    window.history.pushState(null, "", "/");

    const syncRender = await renderOptionsApp("#sync");
    expect(window.location.hash).toBe("#data");
    expect(getButton(syncRender.container, "数据管理").classList.contains("active")).toBe(true);

    act(() => {
      syncRender.root.unmount();
    });
    window.history.pushState(null, "", "/");

    const maintenanceRender = await renderOptionsApp("#maintenance");
    expect(window.location.hash).toBe("#data");
    expect(getButton(maintenanceRender.container, "数据管理").classList.contains("active")).toBe(true);

    act(() => {
      maintenanceRender.root.unmount();
    });
    window.history.pushState(null, "", "/");

    const feedRender = await renderOptionsApp("#feed");
    expect(window.location.hash).toBe("#basic");
    expect(getButton(feedRender.container, "基础").classList.contains("active")).toBe(true);
    expect(feedRender.container.textContent).not.toContain("打捞规则");
  });

  it("shows local linux.do request statistics with tabbed bar charts", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 6, 2, 9, 30).getTime());
    try {
      let state = recordRequestAttempts(defaultAppState, {
        family: "account",
        count: 1,
        at: new Date(2026, 5, 29, 8, 0)
      });
      state = recordRequestAttempts(state, {
        family: "following",
        count: 3,
        at: new Date(2026, 6, 1, 18, 0)
      });
      state = recordRequestAttempts(state, {
        family: "profile",
        count: 2,
        at: new Date(2026, 6, 2, 9, 10)
      });
      setupChrome({ state });
      const { container } = await renderOptionsApp("#request-stats");

      expect(window.location.hash).toBe("#request-stats");
      expect(getButton(container, "请求统计").classList.contains("active")).toBe(true);
      expect(container.querySelector(".request-stats-panel")?.textContent).toContain("失败和被拦截的请求也会计入");
      expect(container.querySelector(".request-stats-total-badge")?.textContent).toBe("总请求6");
      expect(container.querySelector(".request-stats-total-badge")?.getAttribute("aria-label")).toBe("总请求 6");
      expect(container.querySelectorAll(".request-stat-block")).toHaveLength(0);
      expect(container.textContent).toContain("今天 0 点到现在的请求次数。");
      expect(getButton(container, "今天").getAttribute("aria-selected")).toBe("true");
      let hourlyBars = Array.from(container.querySelectorAll(".request-stats-chart-hourly .request-stats-bar-item"));
      expect(hourlyBars).toHaveLength(24);
      expect(hourlyBars[0].getAttribute("aria-label")).toBe("00:00：0");
      expect(hourlyBars[9].getAttribute("aria-label")).toBe("09:00：2");
      expect(hourlyBars[23].getAttribute("aria-label")).toBe("23:00：0");
      expect(hourlyBars[0].querySelector(".request-stats-bar-label")?.textContent).toBe("00");
      expect(hourlyBars[1].querySelector(".request-stats-bar-label")?.textContent).toBe("");
      expect(hourlyBars[3].querySelector(".request-stats-bar-label")?.textContent).toBe("03");
      expect(hourlyBars[9].querySelector(".request-stats-bar-label")?.textContent).toBe("09");
      expect(hourlyBars[23].querySelector(".request-stats-bar-label")?.textContent).toBe("23");
      expect(hourlyBars[9].querySelector(".request-stats-bar-tooltip")?.textContent).toBe("09:00：2");
      expect(hourlyBars[9].getAttribute("tabindex")).toBe("0");

      await act(async () => {
        getButton(container, "昨天").click();
      });

      expect(getButton(container, "昨天").getAttribute("aria-selected")).toBe("true");
      expect(container.textContent).toContain("昨天全天的请求次数。");
      expect(container.textContent).not.toContain("昨天 0 点到现在的请求次数。");
      hourlyBars = Array.from(container.querySelectorAll(".request-stats-chart-hourly .request-stats-bar-item"));
      expect(hourlyBars).toHaveLength(24);
      expect(hourlyBars[18].getAttribute("aria-label")).toBe("18:00：3");
      expect(hourlyBars[23].getAttribute("aria-label")).toBe("23:00：0");
      expect(hourlyBars[17].querySelector(".request-stats-bar-label")?.textContent).toBe("");
      expect(hourlyBars[18].querySelector(".request-stats-bar-label")?.textContent).toBe("18");
      expect(hourlyBars[18].querySelector(".request-stats-bar-tooltip")?.textContent).toBe("18:00：3");

      const dailyBars = Array.from(container.querySelectorAll(".request-stats-chart-daily .request-stats-bar-item"));
      expect(dailyBars).toHaveLength(7);
      expect(dailyBars.map((item) => item.getAttribute("aria-label"))).toEqual(["6/26：0", "6/27：0", "6/28：0", "6/29：1", "6/30：0", "7/1：3", "7/2：2"]);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("checks cloud config status once on open without restoring config", async () => {
    const chromeMock = setupChrome({
      cloudState: {
        binding: {
          bound: true,
          app: "linuxdo-friends",
          linuxDoId: "42",
          tokenType: "Bearer",
          tokenKind: "jwt",
          boundAt: "2026-06-29T00:00:00.000Z"
        },
        status: {
          state: "remote_config",
          checkedAt: "2026-06-29T00:01:00.000Z",
          exportedAt: "2026-06-29T00:00:00.000Z",
          friendCount: 1
        },
        message: "云端配置：1 位佬朋友。"
      },
      cloudArchiveState: sameCloudArchiveState()
    });
    const { container } = await renderOptionsApp("#data");

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "getCloudConfigStatus" });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "getCloudArchiveLocalState" });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "restoreCloudConfig" });
    expect(container.textContent).toContain("已备份");
    expect(container.textContent).toContain("云端配置：1 位佬朋友");
    expect(container.textContent).toContain("账号 42");
    const cloudCard = headingByText(container, "云存档").closest<HTMLElement>(".settings-card");
    expect(cloudCard?.textContent).toContain("备份和恢复可迁移配置。");
    expect(cloudCard?.textContent).not.toContain("可迁移配置已备份到 linuxdo-cloud-save.lafish.workers.dev。");
    expect(container.textContent).not.toContain("chromiumapp.org");
    expect(container.textContent).not.toContain("secret-token");
  });

  it("shows pending backup as the primary cloud backup state in settings", async () => {
    setupChrome();
    const { container } = await renderOptionsApp("#data");
    await act(async () => {
      await Promise.resolve();
    });

    const status = container.querySelector(".cloud-backup-status");
    expect(status?.classList.contains("cloud-backup-different")).toBe(true);
    expect(status?.textContent).toContain("待备份");
    expect(status?.textContent).toContain("建议备份到 linuxdo-cloud-save。");
    const cloudCard = headingByText(container, "云存档").closest<HTMLElement>(".settings-card");
    expect(cloudCard?.textContent).toContain("备份和恢复可迁移配置。");
    expect(cloudCard?.textContent).not.toContain("可迁移配置有更新，尚未备份到 linuxdo-cloud-save.lafish.workers.dev。");
    const disclosure = getDataDisclosure(cloudCard);
    expect(disclosure.textContent).toContain("备份会上传可迁移配置到 linuxdo-cloud-save.lafish.workers.dev");
    expect(disclosure.textContent).toContain("内容包括佬朋友及其备注、打捞规则、请求统计和设置");
    expect(disclosure.textContent).toContain("已配置的 Telegram Bot Token / Chat ID 也会随云存档备份");
    expect(cloudCard?.textContent).not.toContain("备份会把可迁移配置上传到 linuxdo-cloud-save.lafish.workers.dev，包括");
    expect(getButton(container, "备份到云端").classList.contains("primary-action")).toBe(true);
    expect(container.textContent).not.toContain("不一致");
  });

  it("binds and backs up cloud config from the options page", async () => {
    const chromeMock = setupChrome({ cloudState: { binding: { bound: false }, message: "尚未绑定 linuxdo-cloud-save。" } });
    const { container } = await renderOptionsApp("#data");

    await act(async () => {
      getButton(container, "绑定").click();
    });
    await act(async () => {
      getButton(container, "备份到云端").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "bindCloudSave" });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "backupCloudConfig" });
    expect(container.textContent).toContain("已备份 1 位佬朋友到云端。");
    expect(container.querySelector(".cloud-backup-status")?.textContent).toContain("已备份");
    expect(container.textContent).not.toContain("secret-token");
  });

  it("does not bind cloud save when Firefox cloud consent is denied", async () => {
    const chromeMock = setupChrome({ firefoxDataPermissionRequest: false });
    const { container } = await renderOptionsApp("#data");
    chromeMock.sendMessage.mockClear();

    await act(async () => {
      getButton(container, "绑定").click();
      await Promise.resolve();
    });

    expect(chromeMock.permissionsRequest).toHaveBeenCalledWith({ data_collection: DATA_CONSENT_PERMISSIONS.cloudSave });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "bindCloudSave" });
    expect(container.textContent).toContain(DATA_CONSENT_REQUIRED_MESSAGE);
  });

  it("does not back up, restore, or enable automatic cloud backup when Firefox cloud consent is denied", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const chromeMock = setupChrome({
      firefoxDataPermissionRequest: false,
      cloudState: boundCloudState(),
      cloudArchiveState: differentCloudArchiveState()
    });
    const { container } = await renderOptionsApp("#data");
    chromeMock.sendMessage.mockClear();

    await act(async () => {
      getButton(container, "备份到云端").click();
      await Promise.resolve();
      getButton(container, "从云端恢复").click();
      await Promise.resolve();
      container.querySelector<HTMLButtonElement>(".cloud-stats-sync-row .switch-button")?.click();
      await Promise.resolve();
    });

    expect(chromeMock.permissionsRequest).toHaveBeenCalledTimes(3);
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "backupCloudConfig" });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "restoreCloudConfig" });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { requestStatsAutoSyncEnabled: true }
    });
    expect(container.textContent).toContain(DATA_CONSENT_REQUIRED_MESSAGE);
  });

  it("shows daily automatic backup inside the cloud archive card", async () => {
    const state = { ...defaultAppState, settings: { ...defaultAppState.settings, requestStatsAutoSyncEnabled: false } };
    const chromeMock = setupChrome({
      state,
      cloudState: boundCloudState("云端配置：1 位佬朋友。", {
        lastRequestStatsSyncedAt: "2026-07-02T09:00:00.000Z",
        lastRequestStatsTotal: 23
      }),
      cloudArchiveState: sameCloudArchiveState({
        lastRequestStatsSyncedAt: "2026-07-02T09:00:00.000Z",
        lastRequestStatsTotal: 23
      })
    });
    const { container } = await renderOptionsApp("#data");

    const cloudCard = headingByText(container, "云存档").closest<HTMLElement>(".settings-card");
    expect(container.textContent).not.toContain("请求统计每日自动同步");
    expect(cloudCard?.textContent).toContain("每日自动备份");
    expect(cloudCard?.textContent).toContain("上次自动备份");
    expect(cloudCard?.querySelector(".cloud-backup-status")?.textContent).toContain("已备份");

    const toggle = cloudCard?.querySelector<HTMLButtonElement>(".cloud-stats-sync-row .switch-button");
    await act(async () => {
      toggle?.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "updateSettings", settings: { requestStatsAutoSyncEnabled: true } });
  });

  it("keeps daily automatic backup visible but disabled while cloud is unbound", async () => {
    const state = { ...defaultAppState, settings: { ...defaultAppState.settings, requestStatsAutoSyncEnabled: true } };
    setupChrome({
      state,
      cloudState: { binding: { bound: false }, status: { state: "unchecked" }, message: "尚未绑定 linuxdo-cloud-save。" },
      cloudArchiveState: { binding: { bound: false }, archiveState: "unbound" }
    });
    const { container } = await renderOptionsApp("#data");

    expect(container.textContent).toContain("每日自动备份");
    expect(container.textContent).toContain("绑定云存档后可开启。");
    const dailyBackupButton = container.querySelector<HTMLButtonElement>(".cloud-stats-sync-row .switch-button");
    expect(dailyBackupButton?.disabled).toBe(true);
    expect(dailyBackupButton?.textContent).toBe("未绑定");
    expect(dailyBackupButton?.classList.contains("active")).toBe(false);
  });

  it("refreshes cloud binding state when OAuth completion updates cloud auth storage", async () => {
    const chromeMock = setupChrome({
      cloudState: { binding: { bound: false }, status: { state: "unchecked" }, message: "尚未绑定 linuxdo-cloud-save。" },
      cloudArchiveState: { binding: { bound: false }, archiveState: "unbound" }
    });
    const { container } = await renderOptionsApp("#data");

    expect(container.textContent).toContain("尚未绑定云存档。");

    chromeMock.setCloudState(boundCloudState("云端配置：1 位佬朋友。"));
    chromeMock.setCloudArchiveState(sameCloudArchiveState());
    await act(async () => {
      chromeMock.emitStorageChange({
        linuxdoFriendsCloudAuth: {
          oldValue: undefined,
          newValue: {
            app: "linuxdo-friends",
            linuxDoId: "42",
            tokenType: "Bearer",
            tokenKind: "jwt",
            token: "secret-token",
            boundAt: "2026-06-29T00:00:00.000Z"
          }
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "getCloudConfigStatus" });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "getCloudArchiveLocalState" });
    expect(container.textContent).toContain("已备份");
    expect(container.textContent).toContain("账号 42");
    expect(container.textContent).not.toContain("secret-token");
  });

  it("refreshes local cloud archive state when backup metadata changes without rebinding", async () => {
    const chromeMock = setupChrome({
      cloudState: boundCloudState(),
      cloudArchiveState: differentCloudArchiveState()
    });
    const { container } = await renderOptionsApp("#data");

    expect(container.querySelector(".cloud-backup-status")?.textContent).toContain("待备份");

    chromeMock.setCloudArchiveState(sameCloudArchiveState());
    await act(async () => {
      chromeMock.emitStorageChange({
        linuxdoFriendsCloudAuth: {
          oldValue: {
            app: "linuxdo-friends",
            linuxDoId: "42",
            tokenType: "Bearer",
            tokenKind: "jwt",
            boundAt: "2026-06-29T00:00:00.000Z",
            lastConfigDigest: "old-digest",
            lastConfigSyncedAt: "2026-06-29T00:01:00.000Z"
          },
          newValue: {
            app: "linuxdo-friends",
            linuxDoId: "42",
            tokenType: "Bearer",
            tokenKind: "jwt",
            boundAt: "2026-06-29T00:00:00.000Z",
            lastConfigDigest: "digest-1",
            lastConfigSyncedAt: "2026-06-29T00:02:00.000Z"
          }
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".cloud-backup-status")?.textContent).toContain("已备份");
  });

  it("restores cloud config only after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const chromeMock = setupChrome({ cloudState: boundCloudState() });
    const { container } = await renderOptionsApp("#data");

    await act(async () => {
      getButton(container, "从云端恢复").click();
    });

    expect(confirm).toHaveBeenCalled();
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "restoreCloudConfig" });

    confirm.mockReturnValue(true);
    await act(async () => {
      getButton(container, "从云端恢复").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "restoreCloudConfig" });
    expect(container.textContent).toContain("已导入 1 位佬朋友配置。");
    expect(container.querySelector(".cloud-backup-status")?.textContent).toContain("已备份");
  });

  it("refreshes local cloud archive state after migratable config changes", async () => {
    const chromeMock = setupChrome({ cloudArchiveState: sameCloudArchiveState() });
    const { container } = await renderOptionsApp("#basic");

    chromeMock.setCloudArchiveState(differentCloudArchiveState());
    await act(async () => {
      getButton(container, "新标签页").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "updateSettings", settings: { openActivityLinksInPage: false } });
    const archiveStateCalls = chromeMock.sendMessage.mock.calls.filter(([message]) => message.type === "getCloudArchiveLocalState");
    expect(archiveStateCalls.length).toBeGreaterThan(1);
  });

  it("disconnects cloud binding without changing local config UI", async () => {
    const chromeMock = setupChrome({ cloudState: boundCloudState() });
    const { container } = await renderOptionsApp("#data");

    await act(async () => {
      getButton(container, "断开绑定").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "clearCloudBinding" });
    expect(container.textContent).toContain("已断开云存档绑定。");
  });

  it("keeps options page focused on active settings without developer placeholders", async () => {
    const { container } = await renderOptionsApp();

    expect(container.textContent).toContain("本地账号探测");
    expect(container.textContent).toContain("动态跳转");
    expect(container.textContent).not.toContain("后台刷新");
    await act(async () => {
      getButton(container, "佬料打捞").click();
    });
    expect(getButton(container, "佬料打捞").classList.contains("active")).toBe(true);
    expect(container.textContent).toContain("自动捞料");
    expect(container.textContent).toContain("打捞请求范围");
    expect(container.textContent).toContain("打捞间隔");
    expect(container.textContent).not.toContain("启用定时刷新");
    expect(container.textContent).not.toContain("刷新范围");
    expect(container.textContent).not.toContain("刷新间隔");
    expect(container.textContent).not.toContain("后台刷新");
    expect(container.textContent).not.toContain("WIP");
    expect(container.textContent).not.toContain("开发中");
    expect(container.textContent).not.toContain("边界");
    expect(container.textContent).not.toContain("webhook");
    expect(container.textContent).not.toContain("规则匹配");
    expect(container.textContent).not.toContain("本版本只保留入口");
  });

  it("keeps notification settings grouped by channel cards", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp("#notifications");
    const browserCard = getBrowserNotificationCard(container);
    const telegramCard = getTelegramCard(container);
    const telegramActions = getSettingsCardActions(telegramCard);

    expect(getButton(container, "新料通知").classList.contains("active")).toBe(true);
    expect(container.textContent).toContain("新料通知");
    expect(queryHeadingByText(container, "佬有料通知")).toBeNull();
    expect(headingByText(container, "浏览器本地通知")).toBeTruthy();
    expect(headingByText(container, "Telegram")).toBeTruthy();
    expect(headingByText(container, "Webhook")).toBeTruthy();
    expect(container.textContent).toContain("正在施工");
    expect(container.textContent).not.toContain("digest");
    expect(container.textContent).not.toContain("WIP");
    expect(container.textContent).not.toContain("开发中");
    expect(allSettingHeadings(container).every((heading) => heading.querySelector("svg") == null)).toBe(true);
    expect(getSettingsCardActions(browserCard).textContent).toContain("已启用");
    expect(browserCard.querySelector(".settings-card-body")?.textContent).toContain("手动打捞通知");
    expect(telegramActions.textContent).toContain("未启用");
    expect(telegramActions.textContent).toContain("发送测试");
    expect(telegramCard.querySelector(".settings-card-body .switch-button")).toBeNull();
    expect(telegramCard.textContent).toContain("Telegram Bot");
    expect(telegramCard.textContent).toContain("未配置 Bot Token 和 Chat ID");
    const disclosure = getDataDisclosure(telegramCard);
    expect(disclosure.textContent).toContain("Bot Token 和 Chat ID 保存在本地");
    expect(disclosure.textContent).toContain("已配置时会随配置导出和云存档备份");
    expect(disclosure.textContent).toContain("只有发送测试或启用通知时才请求 Telegram API");
    expect(telegramCard.querySelector("#tg-bot-token")).toBeNull();
    expect(telegramCard.querySelector("#tg-chat-id")).toBeNull();

    await act(async () => {
      getButton(telegramCard, "配置").click();
      await Promise.resolve();
    });
    const telegramDialog = getTelegramDialog(container);
    expect(telegramDialog?.textContent).toContain("Telegram Bot 配置");
    expect(telegramDialog?.textContent).toContain("凭据会保存在本地并随配置迁移");
    const saveButton = getButton(telegramDialog!, "保存");
    const saveAndEnableButton = getButton(telegramDialog!, "保存并开启");
    expect(saveButton.classList.contains("primary-action")).toBe(false);
    expect(saveAndEnableButton.classList.contains("primary-action")).toBe(true);
    expect(saveAndEnableButton.disabled).toBe(true);
    const { tokenInput, chatInput } = getTelegramInputs(container);
    await act(async () => {
      setInputValue(tokenInput!, "bot-token");
      tokenInput?.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(chatInput!, "12345");
      chatInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(saveAndEnableButton.disabled).toBe(false);
    await act(async () => {
      getButton(container, "保存").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { telegramBotToken: "bot-token", telegramChatId: "12345" }
    });
    expect(getTelegramDialog(container)).toBeNull();
    expect(telegramCard.textContent).toContain("Telegram 配置已保存。");
  });

  it("keeps Telegram test sending outside the modal and independent from the channel switch", async () => {
    const chromeMock = setupChrome({
      state: {
        ...defaultAppState,
        settings: {
          ...defaultAppState.settings,
          telegramBotToken: "bot-token",
          telegramChatId: "12345"
        }
      }
    });
    const { container } = await renderOptionsApp("#notifications");
    const telegramCard = getTelegramCard(container);

    await act(async () => {
      getButton(telegramCard, "发送测试").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "testTelegramNotification", credentials: { kind: "saved" } });
    expect(telegramCard.textContent).toContain("测试消息已发送，请检查 Telegram。");
  });

  it("does not test or enable Telegram when Firefox Telegram consent is denied", async () => {
    const chromeMock = setupChrome({
      firefoxDataPermissionRequest: false,
      state: {
        ...defaultAppState,
        settings: {
          ...defaultAppState.settings,
          telegramBotToken: "saved-token",
          telegramChatId: "saved-chat"
        }
      }
    });
    const { container } = await renderOptionsApp("#notifications");
    const telegramCard = getTelegramCard(container);
    chromeMock.sendMessage.mockClear();

    await act(async () => {
      getButton(telegramCard, "发送测试").click();
      await Promise.resolve();
      getButton(telegramCard, "配置").click();
      await Promise.resolve();
    });
    const { tokenInput, chatInput } = getTelegramInputs(container);
    await act(async () => {
      setInputValue(tokenInput, "draft-token");
      tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(chatInput, "draft-chat");
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
      getButton(getTelegramDialog(container)!, "保存并开启").click();
      await Promise.resolve();
    });

    expect(chromeMock.permissionsRequest).toHaveBeenCalledTimes(2);
    expect(chromeMock.permissionsRequest).toHaveBeenCalledWith({ data_collection: DATA_CONSENT_PERMISSIONS.telegram });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "testTelegramNotification", credentials: { kind: "saved" } });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({
      type: "updateSettings",
      settings: expect.objectContaining({ laoFindsTelegramNotificationsEnabled: true })
    });
    expect(container.textContent).toContain(DATA_CONSENT_REQUIRED_MESSAGE);
  });

  it("tests Telegram modal draft credentials without saving or enabling", async () => {
    const chromeMock = setupChrome({
      state: {
        ...defaultAppState,
        settings: {
          ...defaultAppState.settings,
          telegramBotToken: "saved-token",
          telegramChatId: "saved-chat",
          laoFindsTelegramNotificationsEnabled: false
        }
      }
    });
    const { container } = await renderOptionsApp("#notifications");
    const telegramCard = getTelegramCard(container);

    await act(async () => {
      getButton(telegramCard, "配置").click();
      await Promise.resolve();
    });
    const { tokenInput, chatInput } = getTelegramInputs(container);
    await act(async () => {
      setInputValue(tokenInput, "draft-token");
      tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(chatInput, "draft-chat");
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    chromeMock.sendMessage.mockClear();

    await act(async () => {
      getButton(getTelegramDialog(container)!, "发送测试消息").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "testTelegramNotification",
      credentials: { kind: "draft", botToken: "draft-token", chatId: "draft-chat" }
    });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({
      type: "updateSettings",
      settings: expect.objectContaining({ telegramBotToken: "draft-token" })
    });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({
      type: "updateSettings",
      settings: expect.objectContaining({ laoFindsTelegramNotificationsEnabled: true })
    });
    expect(getTelegramDialog(container)).not.toBeNull();
  });

  it("saves and enables Telegram from the disabled modal primary action", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp("#notifications");
    const telegramCard = getTelegramCard(container);

    await act(async () => {
      getButton(telegramCard, "配置").click();
      await Promise.resolve();
    });
    const { tokenInput, chatInput } = getTelegramInputs(container);
    await act(async () => {
      setInputValue(tokenInput, "enabled-token");
      tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(chatInput, "enabled-chat");
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      getButton(getTelegramDialog(container)!, "保存并开启").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: {
        telegramBotToken: "enabled-token",
        telegramChatId: "enabled-chat",
        laoFindsTelegramNotificationsEnabled: true
      }
    });
    expect(getTelegramDialog(container)).toBeNull();
    expect(telegramCard.textContent).toContain("Telegram 配置已保存并启用。");
  });

  it("uses the normal save button as the primary Telegram modal action when the channel is enabled", async () => {
    setupChrome({
      state: {
        ...defaultAppState,
        settings: {
          ...defaultAppState.settings,
          laoFindsTelegramNotificationsEnabled: true,
          telegramBotToken: "saved-token",
          telegramChatId: "saved-chat"
        }
      }
    });
    const { container } = await renderOptionsApp("#notifications");
    const telegramCard = getTelegramCard(container);

    await act(async () => {
      getButton(telegramCard, "配置").click();
      await Promise.resolve();
    });
    const dialog = getTelegramDialog(container)!;

    expect(dialog.textContent).not.toContain("保存并开启");
    expect(getButton(dialog, "保存").classList.contains("primary-action")).toBe(true);
  });

  it("preserves saved Telegram credentials when the channel switch is toggled off", async () => {
    const chromeMock = setupChrome({
      state: {
        ...defaultAppState,
        settings: {
          ...defaultAppState.settings,
          laoFindsTelegramNotificationsEnabled: true,
          telegramBotToken: "saved-token",
          telegramChatId: "98765"
        }
      }
    });
    const { container } = await renderOptionsApp("#notifications");
    const telegramCard = getTelegramCard(container);

    await act(async () => {
      getButton(telegramCard, "已启用").click();
      await Promise.resolve();
    });
    await act(async () => {
      getButton(telegramCard, "配置").click();
      await Promise.resolve();
    });
    const { tokenInput, chatInput } = getTelegramInputs(container);

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { laoFindsTelegramNotificationsEnabled: false }
    });
    expect(tokenInput.value).toBe("saved-token");
    expect(chatInput.value).toBe("98765");
  });

  it("discards unsaved Telegram modal drafts on cancel and Escape while keeping backdrop clicks inert", async () => {
    setupChrome();
    const { container } = await renderOptionsApp("#notifications");
    const telegramCard = getTelegramCard(container);

    await act(async () => {
      getButton(telegramCard, "配置").click();
      await Promise.resolve();
    });
    let inputs = getTelegramInputs(container);
    await act(async () => {
      setInputValue(inputs.tokenInput, "cancel-token");
      inputs.tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(inputs.chatInput, "111");
      inputs.chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "取消").click();
      await Promise.resolve();
    });
    await act(async () => {
      getButton(telegramCard, "配置").click();
      await Promise.resolve();
    });
    inputs = getTelegramInputs(container);
    expect(inputs.tokenInput.value).toBe("");
    expect(inputs.chatInput.value).toBe("");

    await act(async () => {
      setInputValue(inputs.tokenInput, "backdrop-token");
      inputs.tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(inputs.chatInput, "222");
      inputs.chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      getTelegramBackdrop(container)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    inputs = getTelegramInputs(container);
    expect(getTelegramDialog(container)).not.toBeNull();
    expect(inputs.tokenInput.value).toBe("backdrop-token");
    expect(inputs.chatInput.value).toBe("222");

    await act(async () => {
      setInputValue(inputs.tokenInput, "escape-token");
      inputs.tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(inputs.chatInput, "333");
      inputs.chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      getButton(telegramCard, "配置").click();
      await Promise.resolve();
    });
    inputs = getTelegramInputs(container);
    expect(inputs.tokenInput.value).toBe("");
    expect(inputs.chatInput.value).toBe("");
  });

  it("keeps Telegram modal drafts when save or test fails", async () => {
    const chromeMock = setupChrome({
      updateSettingsError: "保存失败",
      telegramTestResponse: { ok: false, error: "测试失败" }
    });
    const { container } = await renderOptionsApp("#notifications");
    const telegramCard = getTelegramCard(container);

    await act(async () => {
      getButton(telegramCard, "配置").click();
      await Promise.resolve();
    });
    const { tokenInput, chatInput } = getTelegramInputs(container);
    await act(async () => {
      setInputValue(tokenInput, "draft-token");
      tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(chatInput, "draft-chat");
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "保存").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { telegramBotToken: "draft-token", telegramChatId: "draft-chat" }
    });
    expect(getTelegramDialog(container)).not.toBeNull();
    expect(container.textContent).toContain("保存失败");
    expect(tokenInput.value).toBe("draft-token");
    expect(chatInput.value).toBe("draft-chat");

    chromeMock.sendMessage.mockClear();
    await act(async () => {
      getButton(container, "发送测试消息").click();
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "testTelegramNotification",
      credentials: { kind: "draft", botToken: "draft-token", chatId: "draft-chat" }
    });
    expect(container.textContent).toContain("测试失败");
    expect(tokenInput.value).toBe("draft-token");
    expect(chatInput.value).toBe("draft-chat");
  });

  it("toggles browser notification settings from the notification channel page", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp("#notifications");
    const card = getBrowserNotificationCard(container);
    expect(card.textContent).toContain("手动打捞通知");
    const browserButton = getButton(getSettingsCardActions(card), "已启用");
    const manualButton = getButton(card, "未启用");

    await act(async () => {
      manualButton.click();
      await Promise.resolve();
    });
    await act(async () => {
      browserButton.click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { laoFindsManualNotificationsEnabled: true }
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { laoFindsBrowserNotificationsEnabled: false }
    });
  });

  it("keeps manual browser notifications visible but disabled when the browser channel is off", async () => {
    const chromeMock = setupChrome({
      state: {
        ...defaultAppState,
        settings: {
          ...defaultAppState.settings,
          laoFindsBrowserNotificationsEnabled: false,
          laoFindsManualNotificationsEnabled: true
        }
      }
    });
    const { container } = await renderOptionsApp("#notifications");
    const card = getBrowserNotificationCard(container);
    const manualButton = getButton(card, "已启用");

    expect(card.textContent).toContain("手动打捞通知");
    expect(manualButton.disabled).toBe(true);

    chromeMock.sendMessage.mockClear();
    await act(async () => {
      manualButton.click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { laoFindsManualNotificationsEnabled: false }
    });
  });

  it("separates data tasks into independent settings cards without dividers", async () => {
    const { container } = await renderOptionsApp("#data");
    const migrationHeading = headingByText(container, "配置迁移");
    const cloudHeading = headingByText(container, "云存档");
    const maintenanceHeading = headingByText(container, "数据维护");
    const cloudCard = cloudHeading.closest<HTMLElement>(".settings-card");

    expect(container.querySelectorAll(".options-content .settings-card")).toHaveLength(3);
    expect(migrationHeading.closest(".settings-card")).not.toBe(cloudHeading.closest(".settings-card"));
    expect(cloudHeading.closest(".settings-card")).not.toBe(maintenanceHeading.closest(".settings-card"));
    expect(cloudCard?.textContent).toContain("每日自动备份");
    expect(container.querySelectorAll(".settings-data-disclosure")).toHaveLength(2);
    expect(container.textContent).not.toContain("请求统计每日自动同步");
    expect(container.querySelector(".settings-section-divider")).toBeFalsy();
    expect(container.textContent).toContain("数据维护");
    expect(getButton(container, "数据管理").classList.contains("active")).toBe(true);
  });

  it("keeps settings card headings free of icons", async () => {
    const { container } = await renderOptionsApp("#data");

    expect(allSettingHeadings(container).every((heading) => heading.querySelector("svg") == null)).toBe(true);
  });

  it("scrolls the cloud backup section into view when opened with a hash", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scrollIntoView, configurable: true });
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    try {
      const { container } = await renderOptionsApp("#cloud-backup");

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
      expect(window.location.hash).toBe("#cloud-backup");
      expect(getButton(container, "数据管理").classList.contains("active")).toBe(true);
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  it("shows LDC sponsor links at the bottom of the options page", async () => {
    const { container } = await renderOptionsApp("#sponsor");
    const sponsorLinks = Array.from(container.querySelectorAll<HTMLAnchorElement>(".sponsor-action"));

    expect(container.textContent).toContain("赞助本项目");
    expect(container.textContent).not.toContain("赞助本项目 LDC");
    expect(sponsorLinks.map((link) => link.textContent?.trim())).toEqual(["20 LDC", "200 LDC"]);
    expect(sponsorLinks.map((link) => link.href)).toEqual([
      "https://credit.linux.do/paying/online?token=3b78efe60d34a77c55d52e84d60e33270b5cc69f7aa8979bbab4d1b41b6f95b7",
      "https://credit.linux.do/paying/online?token=276b84998e7864428f277f6d7260f7e65e8c531cda5413cb061ff4a91cc3caa4"
    ]);
    expect(sponsorLinks.every((link) => link.target === "_blank")).toBe(true);
  });

  it("defaults activity navigation to in-page links and switches to new tabs", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp();

    expect(getButton(container, "页内跳转").getAttribute("aria-pressed")).toBe("true");
    expect(getButton(container, "新标签页").getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      getButton(container, "新标签页").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { openActivityLinksInPage: false }
    });
    expect(getButton(container, "页内跳转").getAttribute("aria-pressed")).toBe("false");
    expect(getButton(container, "新标签页").getAttribute("aria-pressed")).toBe("true");
  });

  it("fully manages friends and activity scope from the friends section", async () => {
    const state = updateFriend(
      addFriendFromProfile(defaultAppState, {
        username: "Neo",
        name: "Neo",
        refreshedAt: "2026-06-28T00:00:00.000Z"
      }),
      "neo",
      { activityKinds: ["reply", "boost"] }
    );
    const chromeMock = setupChrome({ state });
    const { container } = await renderOptionsApp("#scope");

    expect(container.textContent).toContain("视奸范围");
    const trigger = container.querySelector<HTMLButtonElement>(".scope-select-trigger");
    expect(trigger?.getAttribute("aria-label")).toBe("视奸范围：回复 / Boost");

    await act(async () => {
      trigger?.click();
    });
    expect(container.querySelector(".scope-select-actions")).toBeTruthy();
    await act(async () => {
      getButton(container, "全不选").click();
    });
    await act(async () => {
      getButton(container, "全选").click();
    });
    expect(container.querySelector(".scope-trigger-card")?.classList.contains("is-count-5")).toBe(true);
    expect(container.querySelectorAll(".scope-trigger-card .scope-trigger-icon")).toHaveLength(5);
    await act(async () => {
      getButton(container, "移除").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateFriend",
      username: "neo",
      patch: { activityKinds: [] }
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateFriend",
      username: "neo",
      patch: { activityKinds: ["topic", "reply", "boost", "reaction", "like"] }
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "removeFriend", username: "neo" });
  });

  it("shows, saves, and clears friend notes from the friends section", async () => {
    const state = updateFriend(
      addFriendFromProfile(defaultAppState, {
        username: "Neo",
        name: "Neo",
        refreshedAt: "2026-06-28T00:00:00.000Z"
      }),
      "neo",
      { note: "NAS" }
    );
    const chromeMock = setupChrome({ state });
    const { container } = await renderOptionsApp("#scope");

    expect(container.querySelector(".friend-note-preview-settings")?.textContent).toBe("NAS");
    const editButton = container.querySelector<HTMLButtonElement>('[aria-label="编辑 @neo 的备注"]');
    await act(async () => editButton?.click());
    const input = container.querySelector<HTMLInputElement>(".friend-note-field input");
    expect(input?.value).toBe("NAS");

    await act(async () => {
      setInputValue(input!, "  Homelab  ");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>(".friend-note-dialog-actions .primary-action")?.click());

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "updateFriend", username: "neo", patch: { note: "Homelab" } });
    expect(container.querySelector(".friend-note-modal")).toBeNull();
    expect(container.querySelector(".friend-note-preview-settings")?.textContent).toBe("Homelab");

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="编辑 @neo 的备注"]')?.click());
    const clearInput = container.querySelector<HTMLInputElement>(".friend-note-field input");
    await act(async () => {
      setInputValue(clearInput!, "   ");
      clearInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>(".friend-note-dialog-actions .primary-action")?.click());

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "updateFriend", username: "neo", patch: { note: "" } });
    expect(container.querySelector(".friend-note-preview-settings")).toBeNull();
  });

  it("keeps the friend note draft open when saving fails", async () => {
    const state = updateFriend(
      addFriendFromProfile(defaultAppState, {
        username: "Neo",
        name: "Neo",
        refreshedAt: "2026-06-28T00:00:00.000Z"
      }),
      "neo",
      { note: "NAS" }
    );
    const chromeMock = setupChrome({ state, updateFriendError: "保存失败" });
    const { container } = await renderOptionsApp("#scope");

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="编辑 @neo 的备注"]')?.click());
    const input = container.querySelector<HTMLInputElement>(".friend-note-field input");
    await act(async () => {
      setInputValue(input!, "失败草稿");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>(".friend-note-dialog-actions .primary-action")?.click());

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "updateFriend", username: "neo", patch: { note: "失败草稿" } });
    expect(container.querySelector(".friend-note-modal")).toBeTruthy();
    expect(container.querySelector<HTMLInputElement>(".friend-note-field input")?.value).toBe("失败草稿");
    expect(container.querySelector(".friend-note-dialog-error")?.textContent).toBe("保存失败");
  });

  it("syncs, looks up, and adds friends from the friends section", async () => {
    const chromeMock = setupChrome({ state: defaultAppState });
    const { container } = await renderOptionsApp("#scope");

    expect(headingByText(container, "关注同步").closest(".settings-card")).not.toBe(headingByText(container, "范围管理").closest(".settings-card"));
    expect(container.querySelectorAll(".options-content .settings-card")).toHaveLength(2);
    const scopeCard = headingByText(container, "范围管理").closest<HTMLElement>(".settings-card");
    expect(scopeCard?.querySelector(".friend-count-footer")).toBeFalsy();

    await act(async () => {
      getButton(container, "获取我的关注列表").click();
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "syncFollowedUsers" });
    expect(container.textContent).toContain("@neo");

    const input = container.querySelector<HTMLInputElement>(".settings-search-input");
    await act(async () => {
      setInputValue(input!, "Trinity");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "查找用户").click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("@trinity");

    await act(async () => {
      getButton(container, "视奸 ta").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "lookupFriendProfile", username: "trinity" });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "addFriendFromKnownUser",
      user: expect.objectContaining({ username: "trinity" }),
      profile: expect.objectContaining({ username: "trinity" })
    });
    expect(scopeCard?.querySelector(".settings-card-actions")?.textContent).toContain("共 1 位佬朋友");
  });

  it("creates, edits, validates, cancels, and deletes lao finds rules from the lao-finds section", async () => {
    const state: AppState = {
      ...addFriendFromProfile(defaultAppState, {
        username: "Neo",
        name: "Neo",
        refreshedAt: "2026-06-28T00:00:00.000Z"
      }),
      laoFindsStartedAt: "2026-06-27T00:00:00.000Z",
      dredgeRules: [
        currentRule({
          id: "rule-ai",
          name: "AI",
          mode: "allow",
          usernames: "all",
          kinds: ["topic"],
          patterns: []
        })
      ]
    };
    const chromeMock = setupChrome({ state });
    const { container } = await renderOptionsApp("#lao-finds");

    expect(container.textContent).toContain("自动捞料");
    expect(container.textContent).toContain("打捞请求范围");
    expect(container.textContent).toContain("打捞间隔");
    expect(container.textContent).toContain("5 到 720 分钟。");
    expect(container.textContent).toContain("需保持插件界面前台显示。");
    expect(container.textContent).toContain("打捞起点");
    expect(container.textContent).toContain("打捞规则");
    expect(container.textContent).toContain("允许");
    expect(container.textContent).toContain("全部内容");
    expect(headingByText(container, "自动捞料").closest(".settings-card")).not.toBe(headingByText(container, "打捞设置").closest(".settings-card"));
    expect(headingByText(container, "打捞设置").closest(".settings-card")).not.toBe(headingByText(container, "打捞规则").closest(".settings-card"));
    expect(headingByText(container, "打捞规则").tagName).toBe("H2");
    const rulesCard = headingByText(container, "打捞规则").closest<HTMLElement>(".settings-card");
    const autoDredgeCard = headingByText(container, "自动捞料").closest<HTMLElement>(".settings-card");
    expect(autoDredgeCard?.querySelector(".settings-card-actions .switch-button")?.textContent).toBe("未启用");
    expect(autoDredgeCard?.textContent).not.toContain("运行状态");
    expect(rulesCard?.querySelector(".settings-card-actions")?.textContent).toContain("新建");
    expect(headingByText(container, "自动捞料").querySelector("svg")).toBeFalsy();
    expect(headingByText(container, "打捞规则").querySelector("svg")).toBeFalsy();
    expect(container.textContent).not.toContain("控制自动捞料");
    expect(container.textContent).not.toContain("按规则只请求");
    expect(container.textContent).not.toContain("全量会按每位用户");
    expect(container.textContent).not.toContain("允许规则负责收集");
    expect(container.textContent).not.toContain("屏蔽规则全局拦截");
    expect(container.textContent).not.toContain("显式保存");
    expect(container.textContent).not.toContain("保存后才会更新规则");
    expect(container.textContent).not.toContain("关闭弹窗会丢弃");
    expect(container.querySelectorAll(".options-content .settings-card")).toHaveLength(3);
    expect(container.textContent).not.toContain("启用定时刷新");
    expect(container.textContent).not.toContain("刷新范围");
    expect(container.textContent).not.toContain("刷新间隔");
    expect(container.querySelector(".dredge-choice-row svg")).toBeFalsy();

    await act(async () => {
      vi.spyOn(window, "confirm").mockReturnValueOnce(true);
      getButton(container, "重设为现在").click();
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "resetLaoFindsStartedAt" });

    chromeMock.sendMessage.mockClear();
    const ruleNameRandom = vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1 / 26)
      .mockReturnValueOnce(2 / 26)
      .mockReturnValue(0);
    await act(async () => {
      getButton(container, "新建").click();
    });
    expect(getRuleDialog(container).textContent).toContain("新建打捞规则");
    expect(getRuleDialog(container).textContent).not.toContain("保存后才会更新规则");
    expect(getRuleDialog(container).textContent).not.toContain("关闭弹窗会丢弃");
    expect(container.querySelector(".dredge-rule-list textarea")).toBeFalsy();
    const createNameInput = Array.from(getRuleDialog(container).querySelectorAll<HTMLInputElement>("input")).find((input) => input.placeholder === "打捞规则ABC");
    expect(createNameInput?.value).toBe("");
    const createTextarea = getRegexTextarea(container);
    expect(createTextarea.placeholder).toContain("留空：匹配所选用户和类型下的全部内容");
    expect(createTextarea.placeholder).toContain("一行一条，按正则匹配标题、摘要、用户名等文本");
    await act(async () => {
      setTextareaValue(createTextarea, "AI\nLLM");
      createTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "upsertDredgeRule" }));
    await act(async () => {
      getButton(container, "保存").click();
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "upsertDredgeRule",
      rule: expect.objectContaining({ schemaVersion: 2, name: "打捞规则ABC", mode: "allow", usernames: "all", patterns: ["AI", "LLM"] })
    });
    ruleNameRandom.mockRestore();
    expect(container.querySelector("[role='dialog']")).toBeFalsy();

    chromeMock.sendMessage.mockClear();
    await act(async () => {
      getButton(container, "编辑").click();
    });
    expect(getRuleDialog(container).textContent).toContain("编辑打捞规则");
    expect(getRegexTextarea(container).value).toBe("");
    await act(async () => {
      getButton(container, "屏蔽").click();
      await Promise.resolve();
    });
    await act(async () => {
      const editTextarea = getRegexTextarea(container);
      setTextareaValue(editTextarea, "[");
      editTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "保存").click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("正则表达式无效");
    expect(getRuleDialog(container)).toBeTruthy();
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "upsertDredgeRule" }));

    await act(async () => {
      const editTextarea = getRegexTextarea(container);
      setTextareaValue(editTextarea, "LLM");
      editTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "保存").click();
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "upsertDredgeRule",
      rule: expect.objectContaining({ id: "rule-ai", schemaVersion: 2, mode: "block", patterns: ["LLM"] })
    });

    chromeMock.sendMessage.mockClear();
    await act(async () => {
      getButton(container, "编辑").click();
    });
    expect(getButton(container, "删除").disabled).toBe(true);
    expect(getRuleDialog(container).textContent).not.toContain("删除");
    const nameInput = Array.from(container.querySelectorAll<HTMLInputElement>(".dredge-rule-field input")).find((input) => input.value === "AI");
    await act(async () => {
      setInputValue(nameInput!, "AI 规则");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
      getButton(container, "取消").click();
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "upsertDredgeRule" }));

    await act(async () => {
      getButton(container, "删除").click();
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "removeDredgeRule", id: "rule-ai" });
  });

  it("keeps Lao Finds rule type all and keyword visibility semantics aligned", async () => {
    const chromeMock = setupChrome({
      state: {
        ...addFriendFromProfile(defaultAppState, {
          username: "Neo",
          name: "Neo",
          refreshedAt: "2026-06-28T00:00:00.000Z"
        }),
        dredgeRules: [currentRule({ id: "old-reaction", name: "旧回应规则", kinds: ["reaction"], patterns: ["legacy-keyword"] })]
      }
    });
    const { container } = await renderOptionsApp("#lao-finds");

    expect(container.textContent).toContain("旧回应规则");
    expect(container.textContent).toContain("回应");
    expect(container.textContent).toContain("全部内容");
    expect(container.textContent).not.toContain("legacy-keyword");

    await act(async () => {
      getButton(container, "新建").click();
    });
    expect(getRuleTypeButtons(container).map((button) => button.textContent)).toEqual(["全部", "话题", "回复", "Boost", "回应", "点赞"]);
    expect(getRuleTypeButton(container, "全部").classList.contains("active")).toBe(true);

    const textarea = getRegexTextarea(container);
    await act(async () => {
      setTextareaValue(textarea, "AI");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await clickRuleTypeButton(container, "话题");
    await clickRuleTypeButton(container, "回复");
    await clickRuleTypeButton(container, "Boost");
    expect(queryRegexTextarea(container)).toBeNull();

    await act(async () => {
      getRuleTypeButton(container, "全部").click();
      await Promise.resolve();
    });
    expect(getRuleTypeButton(container, "全部").classList.contains("active")).toBe(true);
    expect(getRegexTextarea(container).value).toBe("AI");

    await clickRuleTypeButton(container, "话题");
    await clickRuleTypeButton(container, "回复");
    await clickRuleTypeButton(container, "Boost");
    expect(queryRegexTextarea(container)).toBeNull();

    await act(async () => {
      getButton(container, "保存").click();
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "upsertDredgeRule",
      rule: expect.objectContaining({ schemaVersion: 2, kinds: ["reaction", "like"], patterns: [] })
    });
  });

  it("discards lao finds rule modal drafts from close and escape while keeping backdrop clicks inert", async () => {
    const state: AppState = {
      ...addFriendFromProfile(defaultAppState, {
        username: "Neo",
        name: "Neo",
        refreshedAt: "2026-06-28T00:00:00.000Z"
      }),
      dredgeRules: [currentRule({ id: "rule-ai", name: "AI", patterns: ["AI"] })]
    };
    const chromeMock = setupChrome({ state });
    const { container } = await renderOptionsApp("#lao-finds");

    await act(async () => {
      getButton(container, "编辑").click();
    });
    const closeTextarea = getRegexTextarea(container);
    await act(async () => {
      setTextareaValue(closeTextarea, "discarded-close");
      closeTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      getCloseRuleDialogButton(container).click();
      await Promise.resolve();
    });
    expect(container.querySelector("[role='dialog']")).toBeFalsy();
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "upsertDredgeRule" }));

    await act(async () => {
      getButton(container, "编辑").click();
    });
    const backdropTextarea = getRegexTextarea(container);
    await act(async () => {
      setTextareaValue(backdropTextarea, "discarded-backdrop");
      backdropTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      getRuleDialog(container).parentElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(getRuleDialog(container)).toBeTruthy();
    expect(getRegexTextarea(container).value).toBe("discarded-backdrop");
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "upsertDredgeRule" }));

    const escapeTextarea = getRegexTextarea(container);
    await act(async () => {
      setTextareaValue(escapeTextarea, "discarded-escape");
      escapeTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    expect(container.querySelector("[role='dialog']")).toBeFalsy();
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "upsertDredgeRule" }));
  });

  it("locks lao finds rules while timed activity refresh is enabled", async () => {
    const state: AppState = {
      ...defaultAppState,
      settings: { ...defaultAppState.settings, timedActivityRefreshEnabled: true },
      dredgeRules: [
        currentRule({
          id: "rule-ai",
          name: "AI",
          mode: "allow",
          usernames: "all",
          kinds: ["topic"],
          patterns: []
        })
      ]
    };
    setupChrome({ state });
    const { container } = await renderOptionsApp("#lao-finds");

    expect(container.textContent).toContain("关闭自动捞料后可修改规则。");
    expect(getButton(container, "新建").disabled).toBe(true);
    expect(getButton(container, "编辑").disabled).toBe(true);
    expect(getButton(container, "删除").disabled).toBe(true);
    expect(getButton(container, "重设为现在").disabled).toBe(true);
  });

  it("locks lao finds rules while an activity refresh task is running", async () => {
    const state: AppState = {
      ...defaultAppState,
      dredgeRules: [currentRule({ id: "rule-ai", name: "AI", kinds: ["topic"] })]
    };
    const chromeMock = setupChrome({ state });
    const { container } = await renderOptionsApp("#lao-finds");

    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [SITE_DATA_PROGRESS_STORAGE_KEY]: {
            oldValue: undefined,
            newValue: {
              taskId: "activity-running",
              taskType: "activity",
              scope: { kind: "topic" },
              status: "running",
              completed: 0,
              total: 1,
              startedAt: "2026-06-28T00:00:00.000Z",
              updatedAt: "2026-06-28T00:00:00.000Z"
            }
          }
        },
        "session"
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("刷新动态运行中，完成后可修改规则。");
    expect(getButton(container, "新建").disabled).toBe(true);
    expect(getButton(container, "编辑").disabled).toBe(true);
    expect(getButton(container, "删除").disabled).toBe(true);

    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [SITE_DATA_PROGRESS_STORAGE_KEY]: {
            oldValue: undefined,
            newValue: null
          }
        },
        "session"
      );
      await Promise.resolve();
    });
  });

  it("disables an open lao finds rule modal when activity refresh starts", async () => {
    const state: AppState = {
      ...defaultAppState,
      dredgeRules: [currentRule({ id: "rule-ai", name: "AI", patterns: ["AI"] })]
    };
    const chromeMock = setupChrome({ state });
    const { container } = await renderOptionsApp("#lao-finds");

    await act(async () => {
      getButton(container, "编辑").click();
    });
    expect(getButton(container, "保存").disabled).toBe(false);

    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [SITE_DATA_PROGRESS_STORAGE_KEY]: {
            oldValue: undefined,
            newValue: {
              taskId: "activity-running",
              taskType: "activity",
              scope: { kind: "topic" },
              status: "running",
              completed: 0,
              total: 1,
              startedAt: "2026-06-28T00:00:00.000Z",
              updatedAt: "2026-06-28T00:00:00.000Z"
            }
          }
        },
        "session"
      );
      await Promise.resolve();
    });

    expect(getButton(container, "保存").disabled).toBe(true);
    await act(async () => {
      getButton(container, "保存").click();
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "upsertDredgeRule" }));

    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [SITE_DATA_PROGRESS_STORAGE_KEY]: {
            oldValue: undefined,
            newValue: null
          }
        },
        "session"
      );
      await Promise.resolve();
    });
  });

  it("live-syncs durable app state changes into settings without reload", async () => {
    const initialState: AppState = {
      ...defaultAppState,
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: false,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 30
      },
      dredgeRules: []
    };
    const externalState: AppState = {
      ...addFriendFromProfile(defaultAppState, {
        username: "Neo",
        name: "Neo",
        refreshedAt: "2026-06-28T00:00:00.000Z"
      }),
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "all",
        timedActivityRefreshIntervalMinutes: 60,
        telegramBotToken: "external-token",
        telegramChatId: "98765"
      },
      dredgeRules: [
        currentRule({
          id: "rule-ai",
          name: "AI",
          enabled: true,
          mode: "allow",
          usernames: ["neo"],
          kinds: ["topic"],
          patterns: ["LLM"]
        })
      ]
    };
    const chromeMock = setupChrome({ state: initialState });
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "新料通知").click();
    });

    await act(async () => {
      getButton(getTelegramCard(container), "配置").click();
      await Promise.resolve();
    });
    const { tokenInput, chatInput } = getTelegramInputs(container);
    await act(async () => {
      setInputValue(tokenInput!, "unsaved-token");
      tokenInput?.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(chatInput!, "unsaved-chat");
      chatInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(tokenInput?.value).toBe("unsaved-token");
    expect(chatInput?.value).toBe("unsaved-chat");

    await act(async () => {
      chromeMock.emitStorageChange({ [APP_STATE_STORAGE_KEY]: { oldValue: initialState, newValue: externalState } });
      await Promise.resolve();
    });

    expect(tokenInput?.value).toBe("unsaved-token");
    expect(chatInput?.value).toBe("unsaved-chat");

    await act(async () => {
      getButton(container, "取消").click();
      await Promise.resolve();
    });
    await act(async () => {
      getButton(getTelegramCard(container), "配置").click();
      await Promise.resolve();
    });
    const syncedTelegramInputs = getTelegramInputs(container);
    expect(syncedTelegramInputs.tokenInput.value).toBe("external-token");
    expect(syncedTelegramInputs.chatInput.value).toBe("98765");

    await act(async () => {
      getButton(container, "佬料打捞").click();
    });

    expect(getButton(container, "已启用").getAttribute("aria-pressed")).toBe("true");
    expect(getButton(container, "全量").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector<HTMLInputElement>(".timed-interval-input")?.value).toBe("60");
    expect(container.textContent).toContain("关闭自动捞料后可修改规则。");
    expect(container.textContent).toContain("AI");
    expect(container.textContent).toContain("1 条匹配：LLM");
    expect(container.textContent).toContain("@neo");
    expect(getButton(container, "新建").disabled).toBe(true);
    expect(getButton(container, "编辑").disabled).toBe(true);
  });

  it("configures timed refresh from the lao-finds section", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp("#lao-finds");

    expect(container.textContent).toContain("当前没有打捞规则。");
    expect(container.textContent).not.toContain("旧关键词规则");
    expect(container.textContent).not.toContain("黑白规则模型");

    await act(async () => {
      getButton(container, "未启用").click();
    });
    await act(async () => {
      getButton(container, "全量").click();
    });
    const intervalInput = container.querySelector<HTMLInputElement>(".timed-interval-input");
    expect(intervalInput?.value).toBe("20");
    expect(intervalInput?.min).toBe("5");
    expect(intervalInput?.max).toBe("720");
    expect(intervalInput?.step).toBe("5");
    await act(async () => {
      setInputValue(intervalInput!, "5");
      intervalInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { timedActivityRefreshEnabled: true }
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { timedActivityRefreshScopeMode: "all" }
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { timedActivityRefreshIntervalMinutes: 5 }
    });
  });
});

async function renderOptionsApp(hash?: string) {
  if (hash) window.history.pushState(null, "", hash);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(OptionsApp));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container: host, root };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
}

function setTextareaValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
}

function getRegexTextarea(container: HTMLElement) {
  const textarea = queryRegexTextarea(container);
  if (!textarea) throw new Error("Regex textarea not found");
  return textarea;
}

function queryRegexTextarea(container: HTMLElement) {
  return getRuleDialog(container).querySelector<HTMLTextAreaElement>("textarea");
}

function getRuleDialog(container: HTMLElement) {
  const dialog = container.querySelector<HTMLElement>("[role='dialog'][aria-labelledby='dredge-rule-modal-title']");
  if (!dialog) throw new Error("Dredge rule dialog not found");
  return dialog;
}

function getRuleTypeButtons(container: HTMLElement) {
  const field = Array.from(getRuleDialog(container).querySelectorAll<HTMLElement>(".dredge-rule-field")).find((candidate) => candidate.querySelector("span")?.textContent === "类型");
  if (!field) throw new Error("Dredge rule type field not found");
  return Array.from(field.querySelectorAll<HTMLButtonElement>("button"));
}

function getRuleTypeButton(container: HTMLElement, text: string) {
  const button = getRuleTypeButtons(container).find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`Dredge rule type button not found: ${text}`);
  return button;
}

async function clickRuleTypeButton(container: HTMLElement, text: string) {
  await act(async () => {
    getRuleTypeButton(container, text).click();
    await Promise.resolve();
  });
}

function getCloseRuleDialogButton(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>("button[aria-label='关闭规则弹窗']");
  if (!button) throw new Error("Dredge rule dialog close button not found");
  return button;
}

function currentRule(patch: Partial<DredgeRule> = {}): DredgeRule {
  return {
    schemaVersion: 2,
    id: "rule",
    name: "规则",
    enabled: true,
    mode: "allow",
    usernames: "all",
    kinds: ["topic", "reply", "boost", "reaction", "like"],
    patterns: [],
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    ...patch
  };
}

function getBrowserNotificationCard(container: HTMLElement) {
  const card = headingByText(container, "浏览器本地通知").closest<HTMLElement>(".settings-card");
  if (!card) throw new Error("Browser notification card not found");
  return card;
}

function getTelegramCard(container: HTMLElement) {
  const card = headingByText(container, "Telegram").closest<HTMLElement>(".settings-card");
  if (!card) throw new Error("Telegram card not found");
  return card;
}

function getSettingsCardActions(card: HTMLElement) {
  const actions = card.querySelector<HTMLElement>(".settings-card-actions");
  if (!actions) throw new Error("Settings card actions not found");
  return actions;
}

function getDataDisclosure(card: HTMLElement | null) {
  const disclosure = card?.querySelector<HTMLElement>(".settings-data-disclosure");
  if (!disclosure) throw new Error("Settings data disclosure not found");
  return disclosure;
}

function getTelegramDialog(container: HTMLElement) {
  return container.querySelector<HTMLElement>(".telegram-config-modal[role='dialog']");
}

function getTelegramBackdrop(container: HTMLElement) {
  return container.querySelector<HTMLElement>(".modal-backdrop");
}

function getTelegramInputs(container: HTMLElement) {
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input"));
  const tokenInput = inputs.find((input) => input.type === "password" && input.placeholder.startsWith("123456789:"));
  const chatInput = inputs.find((input) => input.type === "text" && input.placeholder === "123456789");
  if (!tokenInput || !chatInput) throw new Error("Telegram inputs not found");
  return { tokenInput, chatInput };
}

function setupChrome({
  state = defaultAppState,
  updateCheck = {
    installedVersion: "1.0.0",
    latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
    status: "up-to-date" as const,
    latestVersion: "1.0.0",
    checkedAt: "2026-06-28T00:00:00.000Z",
    source: "github_release" as const
  },
  cloudState = { binding: { bound: false as const }, status: { state: "unchecked" as const }, message: "尚未绑定 linuxdo-cloud-save。" },
  cloudArchiveState = differentCloudArchiveState(),
  identifyResponse,
  telegramTestResponse = { ok: true, data: "已发送测试消息。" },
  firefoxDataPermissionRequest,
  updateSettingsError = null,
  updateFriendError = null
}: {
  state?: AppState;
  updateCheck?: {
    installedVersion: string;
    latestReleaseUrl: string;
    status: "idle" | "checking" | "up-to-date" | "update-available" | "no-release" | "error";
    latestVersion?: string;
    checkedAt?: string;
    error?: string;
    source?: "github_release";
  };
  cloudState?: Record<string, unknown>;
  cloudArchiveState?: CloudArchiveLocalStateResult;
  identifyResponse?: Promise<unknown>;
  telegramTestResponse?: { ok: true; data: unknown } | { ok: false; error: string };
  firefoxDataPermissionRequest?: boolean;
  updateSettingsError?: string | null;
  updateFriendError?: string | null;
} = {}) {
  let currentState = state;
  let currentCloudState = cloudState;
  let currentCloudArchiveState = cloudArchiveState;
  const permissionsRequest = vi.fn(async () => firefoxDataPermissionRequest ?? true);
  const permissionsGetAll = vi.fn(async () => ({ data_collection: [] as string[] }));
  const storageListeners: Array<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void> = [];
  const sendMessage = vi.fn(async (message) => {
    if (message.type === "getState") return { ok: true, data: currentState };
    if (message.type === "getUpdateCheck") return { ok: true, data: updateCheck };
    if (message.type === "checkForUpdates") return { ok: true, data: updateCheck };
    if (message.type === "identifyCurrentAccount") {
      if (identifyResponse) return identifyResponse;
      return {
        ok: true,
        data: {
          ...currentState,
          currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" }
        }
      };
    }
    if (message.type === "clearCache") return { ok: true, data: currentState };
    if (message.type === "resetExtension") return { ok: true, data: currentState };
    if (message.type === "syncFollowedUsers") {
      currentState = {
        ...currentState,
        followedUsers: {
          ...currentState.followedUsers,
          neo: {
            username: "neo",
            name: "Neo",
            avatarUrl: "https://linux.do/user_avatar/linux.do/neo/96/1.png",
            source: "sync",
            followedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        },
        lastSync: {
          ok: true,
          source: "manual",
          message: "已同步 1 位关注用户。",
          refreshedAt: "2026-06-28T00:00:00.000Z"
        }
      };
      return { ok: true, data: currentState };
    }
    if (message.type === "lookupFriendProfile") {
      const username = String(message.username).trim().replace(/^@/, "").toLowerCase();
      if (!username || username === "ghost") return { ok: false, error: "用户不存在或公开资料不可用。" };
      return {
        ok: true,
        data: {
          username,
          name: username === "trinity" ? "Trinity" : username,
          avatarUrl: `https://linux.do/user_avatar/linux.do/${username}/96/1.png`,
          refreshedAt: "2026-06-28T00:00:00.000Z"
        }
      };
    }
    if (message.type === "addFriendFromKnownUser") {
      currentState = addFriendFromKnownUser(currentState, message.user, message.profile);
      return { ok: true, data: currentState };
    }
    if (message.type === "removeFriend") {
      currentState = removeFriend(currentState, message.username);
      return { ok: true, data: currentState };
    }
    if (message.type === "updateFriend") {
      if (updateFriendError) return { ok: false, error: updateFriendError };
      currentState = updateFriend(currentState, message.username, message.patch);
      return { ok: true, data: currentState };
    }
    if (message.type === "upsertDredgeRule") {
      currentState = upsertDredgeRule(currentState, message.rule);
      return { ok: true, data: currentState };
    }
    if (message.type === "removeDredgeRule") {
      currentState = removeDredgeRule(currentState, message.id);
      return { ok: true, data: currentState };
    }
    if (message.type === "resetLaoFindsStartedAt") {
      currentState = { ...currentState, laoFindsStartedAt: "2026-06-28T00:00:00.000Z" };
      return { ok: true, data: currentState };
    }
    if (message.type === "updateSettings") {
      if (updateSettingsError) return { ok: false, error: updateSettingsError };
      currentState = { ...currentState, settings: { ...currentState.settings, ...message.settings } };
      return { ok: true, data: currentState };
    }
    if (message.type === "testTelegramNotification") return telegramTestResponse;
    if (message.type === "exportConfig") {
      return {
        ok: true,
        data: {
          schemaVersion: 1,
          source: "linuxdo-friends",
          exportedAt: "2026-06-28T00:00:00.000Z",
          friends: {
            neo: {
              username: "neo",
              note: "",
              groups: [],
              pinned: false,
              upgradedAt: "2026-06-28T00:00:00.000Z",
              updatedAt: "2026-06-28T00:00:00.000Z"
            }
          },
          requestStats: { total: 0, byFamily: {}, days: {} },
          settings: defaultAppState.settings
        }
      };
    }
    if (message.type === "importConfig") {
      return {
        ok: true,
        data: {
          ...defaultAppState,
          friends: {
            neo: {
              username: "neo",
              note: "",
              groups: [],
              pinned: false,
              upgradedAt: "2026-06-28T00:00:00.000Z",
              updatedAt: "2026-06-28T00:00:00.000Z"
            }
          },
          lastSync: { ok: true, source: "manual", message: "已导入 1 位佬朋友配置。", refreshedAt: "2026-06-28T00:00:00.000Z" }
        }
      };
    }
    if (message.type === "getCloudArchiveLocalState") return { ok: true, data: currentCloudArchiveState };
    if (message.type === "getCloudConfigStatus") return { ok: true, data: currentCloudState };
    if (message.type === "bindCloudSave") return { ok: true, data: boundCloudState("已绑定 linuxdo-cloud-save。") };
    if (message.type === "backupCloudConfig") {
      currentCloudArchiveState = sameCloudArchiveState();
      return {
        ok: true,
        data: {
          ...boundCloudState("已备份 1 位佬朋友到云端。"),
          archiveState: "same",
          status: { state: "remote_config", checkedAt: "2026-06-29T00:02:00.000Z", exportedAt: "2026-06-29T00:00:00.000Z", friendCount: 1 }
        }
      };
    }
    if (message.type === "restoreCloudConfig") {
      currentCloudArchiveState = sameCloudArchiveState();
      return {
        ok: true,
        data: {
          ...boundCloudState("已导入 1 位佬朋友配置。"),
          archiveState: "same",
          state: {
            ...defaultAppState,
            friends: {
              neo: {
                username: "neo",
                note: "",
                groups: [],
                pinned: false,
                activityKinds: ["topic", "reply", "boost", "reaction", "like"],
                upgradedAt: "2026-06-29T00:00:00.000Z",
                updatedAt: "2026-06-29T00:00:00.000Z"
              }
            },
            lastSync: { ok: true, source: "manual", message: "已导入 1 位佬朋友配置。", refreshedAt: "2026-06-29T00:00:00.000Z" }
          }
        }
      };
    }
    if (message.type === "clearCloudBinding") {
      return { ok: true, data: { binding: { bound: false }, message: "已断开云存档绑定。" } };
    }
    return { ok: false, error: "unexpected command" };
  });
  vi.stubGlobal("chrome", {
    storage: {
      local: createMockStorage({}),
      onChanged: {
        addListener: vi.fn((callback) => {
          storageListeners.push(callback);
        }),
        removeListener: vi.fn((callback) => {
          const index = storageListeners.indexOf(callback);
          if (index >= 0) storageListeners.splice(index, 1);
        })
      }
    },
    runtime: {
      sendMessage,
      getManifest: vi.fn(() => ({
        version: "1.0.0",
        ...(firefoxDataPermissionRequest === undefined ? {} : { browser_specific_settings: { gecko: { id: "linuxdo-friends@lafish" } } })
      }))
    },
    permissions: { request: permissionsRequest, getAll: permissionsGetAll }
  });
  if (firefoxDataPermissionRequest !== undefined) {
    vi.stubGlobal("browser", { permissions: { request: permissionsRequest, getAll: permissionsGetAll } });
  }
  return {
    sendMessage,
    permissionsRequest,
    setCloudState(nextCloudState: Record<string, unknown>) {
      currentCloudState = nextCloudState;
    },
    setCloudArchiveState(nextCloudArchiveState: CloudArchiveLocalStateResult) {
      currentCloudArchiveState = nextCloudArchiveState;
    },
    emitStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName = "local") {
      for (const listener of storageListeners) listener(changes, areaName);
    }
  };
}

function headingByText(container: HTMLElement, text: string): HTMLHeadingElement {
  const heading = queryHeadingByText(container, text);
  if (!heading) throw new Error(`heading not found: ${text}`);
  return heading;
}

function queryHeadingByText(container: HTMLElement, text: string): HTMLHeadingElement | null {
  return Array.from(container.querySelectorAll<HTMLHeadingElement>("h2, h3")).find((candidate) => candidate.textContent === text) ?? null;
}

function allSettingHeadings(container: HTMLElement): HTMLHeadingElement[] {
  return Array.from(container.querySelectorAll<HTMLHeadingElement>(".options-content h2, .options-content h3"));
}

function createPendingIdentifyResponse() {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise((resolve) => {
    resolvePromise = () =>
      resolve({
        ok: true,
        data: {
          ...defaultAppState,
          currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" }
        }
      });
  });
  return { promise, resolve: resolvePromise };
}

function boundCloudState(message = "云端配置：1 位佬朋友。", bindingOverrides: Record<string, unknown> = {}) {
  return {
    binding: {
      bound: true,
      app: "linuxdo-friends",
      linuxDoId: "42",
      tokenType: "Bearer",
      tokenKind: "jwt",
      boundAt: "2026-06-29T00:00:00.000Z",
      lastBackupAt: "2026-06-29T00:02:00.000Z",
      lastRestoreAt: "2026-06-29T00:03:00.000Z",
      ...bindingOverrides
    },
    status: {
      state: "remote_config",
      checkedAt: "2026-06-29T00:01:00.000Z",
      exportedAt: "2026-06-29T00:00:00.000Z",
      friendCount: 1
    },
    message
  };
}

function sameCloudArchiveState(bindingOverrides: Record<string, unknown> = {}): CloudArchiveLocalStateResult {
  return {
    binding: {
      bound: true,
      app: "linuxdo-friends",
      linuxDoId: "42",
      tokenType: "Bearer",
      tokenKind: "jwt",
      boundAt: "2026-06-29T00:00:00.000Z",
      lastBackupAt: "2026-06-29T00:02:00.000Z",
      lastRestoreAt: "2026-06-29T00:03:00.000Z",
      lastConfigDigest: "digest-1",
      lastConfigSyncedAt: "2026-06-29T00:02:00.000Z",
      ...bindingOverrides
    },
    archiveState: "same",
    syncedAt: "2026-06-29T00:02:00.000Z"
  };
}

function differentCloudArchiveState(): CloudArchiveLocalStateResult {
  return {
    binding: {
      bound: true,
      app: "linuxdo-friends",
      linuxDoId: "42",
      tokenType: "Bearer",
      tokenKind: "jwt",
      boundAt: "2026-06-29T00:00:00.000Z",
      lastBackupAt: "2026-06-29T00:02:00.000Z",
      lastRestoreAt: "2026-06-29T00:03:00.000Z",
      lastConfigDigest: "digest-1",
      lastConfigSyncedAt: "2026-06-29T00:02:00.000Z"
    },
    archiveState: "different"
  };
}

function getButton(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}
