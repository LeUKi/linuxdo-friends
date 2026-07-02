import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addFriendFromKnownUser, addFriendFromProfile, removeFriend, updateFriend } from "../domain/friends";
import { removeDredgeRule, upsertDredgeRule } from "../domain/laoFinds";
import { defaultAppState } from "../domain/defaultState";
import type { AppState, CloudArchiveLocalStateResult } from "../shared/types";
import { resetAppStateObserverForTest, resetRuntimeObserversForTest } from "../state/atoms";
import { APP_STATE_STORAGE_KEY } from "../storage/storage";
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
    expect(container.textContent).toContain("本地账号探测");
    expect(container.textContent).toContain("动态跳转");
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
    expect(status?.textContent).toContain("建议备份到云端。");
    expect(container.textContent).toContain("本地配置有更新，尚未备份到云端。");
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

  it("refreshes cloud binding state when OAuth completion updates cloud auth storage", async () => {
    const chromeMock = setupChrome({
      cloudState: { binding: { bound: false }, status: { state: "unchecked" }, message: "尚未绑定 linuxdo-cloud-save。" },
      cloudArchiveState: { binding: { bound: false }, archiveState: "unbound" }
    });
    const { container } = await renderOptionsApp("#data");

    expect(container.textContent).toContain("尚未绑定 linuxdo-cloud-save。");

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
      getButton(container, "佬有料").click();
    });
    expect(headingByText(container, "佬有料").querySelector(".lucide-telescope")).toBeTruthy();
    expect(container.textContent).toContain("定时刷新");
    expect(container.textContent).not.toContain("后台刷新");
    expect(container.textContent).not.toContain("正在施工");
    expect(container.querySelector(".settings-construction-card[aria-label='后台刷新设置正在施工']")).toBeFalsy();
    expect(container.textContent).not.toContain("边界");
    expect(container.textContent).not.toContain("webhook");
    expect(container.textContent).not.toContain("规则匹配");
    expect(container.textContent).not.toContain("本版本只保留入口");
  });

  it("keeps Telegram notification settings on a dedicated notification channel page", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp("#notifications");

    expect(getButton(container, "通知渠道").classList.contains("active")).toBe(true);
    expect(container.textContent).toContain("通知渠道");
    expect(container.textContent).toContain("Telegram");
    expect(container.textContent).toContain("Webhook");

    const { tokenInput, chatInput } = getTelegramInputs(container);
    await act(async () => {
      setInputValue(tokenInput!, "bot-token");
      tokenInput?.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue(chatInput!, "12345");
      chatInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "保存").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { telegramBotToken: "bot-token", telegramChatId: "12345" }
    });
  });

  it("groups config migration and cloud backup in one panel with a divider", async () => {
    const { container } = await renderOptionsApp("#data");
    const migrationHeading = headingByText(container, "配置迁移");
    const cloudHeading = headingByText(container, "云端备份");
    const sharedPanel = migrationHeading.closest("section");

    expect(sharedPanel).toBeTruthy();
    expect(sharedPanel).toBe(cloudHeading.closest("section"));
    expect(sharedPanel?.querySelector(".settings-section-divider")).toBeTruthy();
    expect(container.textContent).toContain("数据维护");
    expect(getButton(container, "数据管理").classList.contains("active")).toBe(true);
  });

  it("shows a cloud icon before the cloud backup title", async () => {
    const { container } = await renderOptionsApp("#data");
    const cloudHeading = headingByText(container, "云端备份");

    expect(cloudHeading.classList.contains("settings-title-with-icon")).toBe(true);
    expect(cloudHeading.querySelector("svg")).toBeTruthy();
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
      patch: { activityKinds: ["topic", "reply", "boost", "reaction"] }
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "removeFriend", username: "neo" });
  });

  it("syncs, looks up, and adds friends from the friends section", async () => {
    const chromeMock = setupChrome({ state: defaultAppState });
    const { container } = await renderOptionsApp("#scope");

    await act(async () => {
      getButton(container, "获取我的关注列表").click();
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "syncFollowedUsers" });
    expect(container.textContent).toContain("Neo");

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
  });

  it("creates, edits, and deletes lao finds rules from the lao-finds section", async () => {
    const state: AppState = {
      ...addFriendFromProfile(defaultAppState, {
        username: "Neo",
        name: "Neo",
        refreshedAt: "2026-06-28T00:00:00.000Z"
      }),
      laoFindsStartedAt: "2026-06-27T00:00:00.000Z",
      dredgeRules: [
        {
          id: "rule-ai",
          name: "AI",
          enabled: true,
          usernames: "all",
          kinds: ["topic"],
          keywords: [],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      ]
    };
    const chromeMock = setupChrome({ state });
    const { container } = await renderOptionsApp("#lao-finds");

    expect(container.textContent).toContain("定时刷新");
    expect(container.textContent).toContain("保持插件界面打开，自动捞料才会运行。");
    expect(container.textContent).toContain("打捞起点");
    expect(container.textContent).toContain("打捞规则");
    expect(headingByText(container, "佬有料").querySelector(".lucide-telescope")).toBeTruthy();
    expect(headingByText(container, "打捞规则").querySelector(".lucide-telescope")).toBeTruthy();
    await act(async () => {
      vi.spyOn(window, "confirm").mockReturnValueOnce(true);
      getButton(container, "重设为现在").click();
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "新建").click();
    });
    await act(async () => {
      getButton(container, "回复").click();
    });
    await act(async () => {
      getButton(container, "Neo").click();
    });

    const keywordInput = Array.from(container.querySelectorAll<HTMLInputElement>(".dredge-rule-field input")).find(
      (input) => input.placeholder === "空白表示打捞所选范围内全部动态"
    );
    await act(async () => {
      setInputValue(keywordInput!, "AI,LLM");
      keywordInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "删除").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "resetLaoFindsStartedAt"
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "upsertDredgeRule",
      rule: expect.objectContaining({ name: "新打捞规则", usernames: "all", kinds: ["topic", "reply", "boost", "reaction"] })
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "upsertDredgeRule",
      rule: expect.objectContaining({ id: "rule-ai", kinds: ["topic", "reply"] })
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "upsertDredgeRule",
      rule: expect.objectContaining({ id: "rule-ai", usernames: ["neo"] })
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "upsertDredgeRule",
      rule: expect.objectContaining({ id: "rule-ai", keywords: ["AI", "LLM"] })
    });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "removeDredgeRule", id: "rule-ai" });
  });

  it("locks lao finds rules while timed activity refresh is enabled", async () => {
    const state: AppState = {
      ...defaultAppState,
      settings: { ...defaultAppState.settings, timedActivityRefreshEnabled: true },
      dredgeRules: [
        {
          id: "rule-ai",
          name: "AI",
          enabled: true,
          usernames: "all",
          kinds: ["topic"],
          keywords: [],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      ]
    };
    setupChrome({ state });
    const { container } = await renderOptionsApp("#lao-finds");

    expect(container.textContent).toContain("关闭自动捞料后可修改规则。");
    expect(getButton(container, "新建").disabled).toBe(true);
    expect(getButton(container, "删除").disabled).toBe(true);
    expect(getButton(container, "重设为现在").disabled).toBe(true);
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
        {
          id: "rule-ai",
          name: "AI",
          enabled: true,
          usernames: ["neo"],
          kinds: ["topic"],
          keywords: ["LLM"],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      ]
    };
    const chromeMock = setupChrome({ state: initialState });
    const { container } = await renderOptionsApp();

    await act(async () => {
      getButton(container, "通知渠道").click();
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

    expect(tokenInput?.value).toBe("external-token");
    expect(chatInput?.value).toBe("98765");

    await act(async () => {
      getButton(container, "佬有料").click();
    });

    expect(getButton(container, "已启用").getAttribute("aria-pressed")).toBe("true");
    expect(getButton(container, "全量").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector<HTMLInputElement>(".timed-interval-input")?.value).toBe("60");
    expect(container.textContent).toContain("关闭自动捞料后可修改规则。");
    expect(Array.from(container.querySelectorAll<HTMLInputElement>(".dredge-rule-field input")).some((input) => input.value === "AI")).toBe(true);
    expect(container.textContent).toContain("Neo");
    expect(getButton(container, "新建").disabled).toBe(true);
  });

  it("configures timed refresh from the lao-finds section", async () => {
    const chromeMock = setupChrome();
    const { container } = await renderOptionsApp("#lao-finds");

    await act(async () => {
      getButton(container, "未启用").click();
    });
    await act(async () => {
      getButton(container, "全量").click();
    });
    const intervalInput = container.querySelector<HTMLInputElement>(".timed-interval-input");
    await act(async () => {
      setInputValue(intervalInput!, "60");
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
      settings: { timedActivityRefreshIntervalMinutes: 60 }
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
  identifyResponse
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
} = {}) {
  let currentState = state;
  let currentCloudState = cloudState;
  let currentCloudArchiveState = cloudArchiveState;
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
      currentState = { ...currentState, settings: { ...currentState.settings, ...message.settings } };
      return { ok: true, data: currentState };
    }
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
                activityKinds: ["topic", "reply", "boost", "reaction"],
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
      getManifest: vi.fn(() => ({ version: "1.0.0" }))
    }
  });
  return {
    sendMessage,
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
  const heading = Array.from(container.querySelectorAll<HTMLHeadingElement>("h2, h3")).find((candidate) => candidate.textContent === text);
  if (!heading) throw new Error(`heading not found: ${text}`);
  return heading;
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

function boundCloudState(message = "云端配置：1 位佬朋友。") {
  return {
    binding: {
      bound: true,
      app: "linuxdo-friends",
      linuxDoId: "42",
      tokenType: "Bearer",
      tokenKind: "jwt",
      boundAt: "2026-06-29T00:00:00.000Z",
      lastBackupAt: "2026-06-29T00:02:00.000Z",
      lastRestoreAt: "2026-06-29T00:03:00.000Z"
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

function sameCloudArchiveState(): CloudArchiveLocalStateResult {
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
