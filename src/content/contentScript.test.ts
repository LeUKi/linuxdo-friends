import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractBoosts, extractReactions, extractUserActions, normalizeFriendActivity } from "../domain/activity";
import { extractFriendProfile } from "../api/profileParser";
import { defaultAppState } from "../domain/defaultState";
import { addFriendFromProfile } from "../domain/friends";

const nativePushState = window.history.pushState;
const nativeReplaceState = window.history.replaceState;

describe("content script friend markers", () => {
  beforeEach(async () => {
    const previousModule = await import("./contentScript").catch(() => null);
    previousModule?.resetContentScriptForTest?.();
    vi.useRealTimers();
    vi.resetModules();
    vi.unstubAllGlobals();
    window.history.pushState = nativePushState;
    window.history.replaceState = nativeReplaceState;
    document.head.innerHTML = "";
    document.documentElement.removeAttribute("class");
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-color-scheme");
    document.documentElement.removeAttribute("data-color-mode");
    document.documentElement.removeAttribute("data-scheme");
    document.documentElement.removeAttribute("data-linuxdo-friends-theme");
    document.body.innerHTML = "";
    document.body.removeAttribute("class");
    document.body.removeAttribute("style");
    document.body.removeAttribute("data-theme");
    document.body.removeAttribute("data-color-scheme");
    document.body.removeAttribute("data-color-mode");
    document.body.removeAttribute("data-scheme");
  });

  it("marks only known friends and remains idempotent", async () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      name: "Neo",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    document.body.innerHTML = `
      <a href="/u/neil"><img class="avatar" src="/user_avatar/linux.do/neil/48/1.png" alt="">Neo</a>
      <a href="/u/neil" class="username">@neil</a>
      <a href="/u/neil/summary" class="user-navigation-tab">总结</a>
      <a href="/u/neil"><img class="avatar" src="/user_avatar/linux.do/neil/48/1.png" alt="">neil</a>
      <a href="/u/other">Other</a>
    `;

    const { markFriends } = await import("./contentScript");
    markFriends(state);
    markFriends(state);

    const friendLink = document.querySelector<HTMLAnchorElement>('a[href="/u/neil"]');
    expect(document.querySelectorAll(".linuxdo-friends-marker")).toHaveLength(0);
    expect(friendLink?.classList.contains("linuxdo-friends-friend-link")).toBe(false);
    expect(friendLink?.querySelector("img")?.classList.contains("linuxdo-friends-friend-avatar")).toBe(true);
    expect(friendLink?.querySelector(".linuxdo-friends-name-mark")?.textContent).toBe("Neo");
    expect(friendLink?.textContent).toBe("Neo");
    expect(document.querySelector('a.username')?.querySelector(".linuxdo-friends-name-mark")).toBeNull();
    expect(document.querySelector('a[href="/u/neil/summary"]')?.querySelector(".linuxdo-friends-name-mark")).toBeNull();
    const plainUsernameLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/u/neil"]')).find(
      (link) => link.textContent?.trim() === "neil"
    );
    expect(plainUsernameLink?.querySelector(".linuxdo-friends-name-mark")).toBeNull();
    expect(document.querySelector('a[href="/u/other"]')?.textContent).toBe("Other");
    const pageStyle = document.getElementById("linuxdo-friends-page-style")?.textContent ?? "";
    expect(pageStyle).toContain("linuxdo-friends-friend-avatar");
    expect(pageStyle).toContain("linuxdo-friends-name-mark");
    expect(pageStyle).not.toContain("outline:");
    expect(pageStyle).toContain("0 0 52px color-mix(in srgb, var(--linuxdo-friends-accent) 20%, transparent)");
    expect(pageStyle).toContain("0 0 68px color-mix(in srgb, var(--linuxdo-friends-accent) 28%, transparent)");
    expect(pageStyle).toContain("animation: linuxdo-friends-avatar-breathe");
    expect(pageStyle).toContain("@media (prefers-reduced-motion: reduce)");
    expect(pageStyle).toContain("height: 34%");
    expect(pageStyle).toContain("padding-inline: 1ch");
    expect(pageStyle).toContain("top: 56%");
    expect(pageStyle.match(/\.linuxdo-friends-name-mark \{[^}]+}/)?.[0]).not.toContain("color:");
  });

  it("detects explicit page theme signals before rendered background fallback", async () => {
    document.documentElement.dataset.theme = "dark";
    document.body.style.backgroundColor = "rgb(255, 255, 255)";

    const { detectPageTheme } = await import("./contentScript");

    expect(detectPageTheme()).toBe("dark");
  });

  it("falls back to rendered background readability when no page theme signal exists", async () => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "rgb(250, 250, 250)";

    const { detectPageTheme } = await import("./contentScript");

    expect(detectPageTheme()).toBe("light");
  });

  it("coalesces theme sync when a Discourse theme target appears after startup", async () => {
    vi.useFakeTimers();
    document.body.style.backgroundColor = "rgb(250, 250, 250)";
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    await import("./contentScript");
    expect(document.documentElement.dataset.linuxdoFriendsTheme).toBe("light");

    document.body.insertAdjacentHTML("beforeend", '<main id="discourse-root" data-theme="light"></main>');
    document.getElementById("discourse-root")?.setAttribute("data-theme", "dark");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);

    expect(document.documentElement.dataset.linuxdoFriendsTheme).toBe("dark");
    vi.useRealTimers();
  });

  it("syncs page theme when Discourse toggles light and dark stylesheet media", async () => {
    vi.useFakeTimers();
    document.head.insertAdjacentHTML(
      "beforeend",
      '<link class="light-scheme" rel="stylesheet" media="all"><link class="dark-scheme" rel="stylesheet" media="none">'
    );
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    vi.stubGlobal("getComputedStyle", ((element: Element) => {
      const style = originalGetComputedStyle(element);
      if (element !== document.documentElement) return style;
      return new Proxy(style, {
        get(target, prop, receiver) {
          if (prop === "getPropertyValue") {
            return (name: string) => {
              if (name === "--scheme-type") {
                return document.querySelector<HTMLLinkElement>("link.dark-scheme")?.media === "all" ? "dark" : "light";
              }
              return target.getPropertyValue(name);
            };
          }
          return Reflect.get(target, prop, receiver);
        }
      });
    }) as typeof window.getComputedStyle);
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    await import("./contentScript");
    expect(document.documentElement.dataset.linuxdoFriendsTheme).toBe("light");

    const lightLink = document.querySelector<HTMLLinkElement>("link.light-scheme");
    const darkLink = document.querySelector<HTMLLinkElement>("link.dark-scheme");
    lightLink?.setAttribute("media", "none");
    darkLink?.setAttribute("media", "all");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);

    expect(document.documentElement.dataset.linuxdoFriendsTheme).toBe("dark");
    vi.useRealTimers();
  });

  it("does not rescan page theme for ordinary subtree attribute mutations", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="ordinary-node"></div>';
    document.body.style.backgroundColor = "rgb(250, 250, 250)";
    const getComputedStyleSpy = vi.fn(window.getComputedStyle.bind(window));
    vi.stubGlobal("getComputedStyle", getComputedStyleSpy);
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { syncPageTheme } = await import("./contentScript");
    await flushContentScriptAsyncWork();
    syncPageTheme();
    await vi.waitFor(() => expect(getComputedStyleSpy).toHaveBeenCalled());
    getComputedStyleSpy.mockClear();
    document.getElementById("ordinary-node")?.setAttribute("class", "dark");
    const themeBefore = document.documentElement.dataset.linuxdoFriendsTheme;
    await vi.advanceTimersByTimeAsync(100);

    expect(document.documentElement.dataset.linuxdoFriendsTheme).toBe(themeBefore);
    vi.useRealTimers();
  });

  it("removes stale markers when the friend set changes", async () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      name: "Neo",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    document.body.innerHTML = '<a href="/u/neil"><img class="avatar" src="/avatar.png" alt="">Neo</a>';

    const { markFriends } = await import("./contentScript");
    markFriends(state);
    markFriends(defaultAppState);

    expect(document.querySelectorAll(".linuxdo-friends-marker")).toHaveLength(0);
    expect(document.querySelector('a[href="/u/neil"]')?.textContent).toBe("Neo");
    expect(document.querySelector('a[href="/u/neil"]')?.querySelector(".linuxdo-friends-name-mark")).toBeNull();
    expect(document.querySelector("img")?.classList.contains("linuxdo-friends-friend-avatar")).toBe(false);
  });

  it("reapplies friend markers after Discourse-style in-page navigation", async () => {
    vi.useFakeTimers();
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      name: "Neo",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    document.body.innerHTML = `
      <main id="main-outlet">
        <a id="initial-neil" href="/u/neil"><img class="avatar" src="/user_avatar/linux.do/neil/48/1.png" alt="">Neo</a>
        <a href="/u/other">Other</a>
      </main>
    `;
    const sendMessage = vi.fn(async () => ({ ok: true, data: state }));
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    await import("./contentScript");
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "getState" }));
    await flushContentScriptAsyncWork();
    await waitForFriendMark("#initial-neil");
    document.getElementById("main-outlet")?.insertAdjacentHTML(
      "beforeend",
      '<a id="routed-neil" href="/u/neil"><img class="avatar" src="/user_avatar/linux.do/neil/48/1.png" alt="">Neo</a>'
    );
    window.history.pushState({}, "", "/u/neil");
    await waitForFriendMark("#routed-neil");

    const friendLink = document.querySelector<HTMLAnchorElement>("#routed-neil");
    expect(friendLink?.querySelector(".linuxdo-friends-name-mark")?.textContent).toBe("Neo");
    expect(friendLink?.querySelector("img")?.classList.contains("linuxdo-friends-friend-avatar")).toBe(true);
    vi.useRealTimers();
  });

  it("adds a profile page action button that can add the displayed user", async () => {
    window.history.replaceState({}, "", "/u/misaka7369/summary");
    document.body.innerHTML = `
      <section class="user-main">
        <div class="names"><h1>星</h1><span class="username">Misaka7369</span></div>
        <img class="avatar" src="https://linux.do/user_avatar/linux.do/misaka7369/96/1.png" alt="">
        <div class="controls">
          <button class="btn btn-primary">私信</button>
          <button class="btn">取消关注</button>
          <button class="btn">添加用户标签</button>
        </div>
      </section>
    `;
    const addedState = addFriendFromProfile(defaultAppState, {
      username: "misaka7369",
      name: "星",
      avatarUrl: "https://linux.do/user_avatar/linux.do/misaka7369/96/1.png",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    const sendMessage = vi.fn(async (message: unknown) => {
      if (isHeartbeatMessage(message)) return { ok: true };
      if (isGetStateMessage(message)) return { ok: true, data: defaultAppState };
      if (isAddFriendFromKnownUserMessage(message)) return { ok: true, data: addedState };
      return { ok: true, data: defaultAppState };
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    await import("./contentScript");
    await Promise.resolve();
    await Promise.resolve();

    const button = document.getElementById("linuxdo-friends-profile-action") as HTMLButtonElement | null;
    expect(button?.textContent).toBe("视奸");
    expect(button?.dataset.linuxdoFriendsActive).toBe("false");
    expect(Array.from(document.querySelectorAll(".controls > button")).map((item) => item.textContent)).toEqual([
      "私信",
      "取消关注",
      "视奸",
      "添加用户标签"
    ]);

    button?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({
      type: "addFriendFromKnownUser",
      user: {
        username: "misaka7369",
        name: "星",
        avatarUrl: "https://linux.do/user_avatar/linux.do/misaka7369/96/1.png"
      }
    });
    expect(button?.textContent).toBe("取消视奸");
    expect(button?.dataset.linuxdoFriendsActive).toBe("true");
  });

  it("lets a profile page action remove an existing friend", async () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "misaka7369",
      name: "星",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    window.history.replaceState({}, "", "/u/misaka7369");
    document.body.innerHTML = `
      <section class="user-main">
        <div class="names"><h1>星</h1><span class="username">Misaka7369</span></div>
        <div class="controls">
          <button class="btn">取消关注</button>
        </div>
      </section>
    `;
    const sendMessage = vi.fn(async (message: unknown) => {
      if (isHeartbeatMessage(message)) return { ok: true };
      if (isGetStateMessage(message)) return { ok: true, data: state };
      if (isRemoveFriendMessage(message)) return { ok: true, data: defaultAppState };
      return { ok: true, data: state };
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    await import("./contentScript");
    await Promise.resolve();
    await Promise.resolve();

    const button = document.getElementById("linuxdo-friends-profile-action") as HTMLButtonElement | null;
    expect(button?.textContent).toBe("取消视奸");
    expect(button?.dataset.linuxdoFriendsActive).toBe("true");

    button?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({ type: "removeFriend", username: "misaka7369" });
    expect(button?.textContent).toBe("视奸");
    expect(button?.dataset.linuxdoFriendsActive).toBe("false");
  });

  it("inserts profile page action as its own list item beside Discourse follow controls", async () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "misaka7369",
      name: "星",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    window.history.replaceState({}, "", "/u/misaka7369/summary");
    document.body.innerHTML = `
      <section class="user-main">
        <div class="names"><h1>星</h1><span class="username">Misaka7369</span></div>
        <section class="controls">
          <ul>
            <li><button class="btn btn-primary compose-pm">私信</button></li>
            <li class="user-profile-controls-outlet notification-level"><summary class="btn">常规</summary></li>
            <li><button class="btn category-expert-endorse-btn">认可</button></li>
            <li class="user-profile-controls-outlet follow-button-container">
              <div class="ember-view"><button class="btn">取消关注</button></div>
            </li>
          </ul>
        </section>
      </section>
    `;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: unknown) => {
          if (isHeartbeatMessage(message)) return { ok: true };
          if (isGetStateMessage(message)) return { ok: true, data: state };
          return { ok: true, data: state };
        }),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    await import("./contentScript");
    await Promise.resolve();
    await Promise.resolve();

    const controlItems = Array.from(document.querySelectorAll<HTMLElement>(".controls > ul > li"));
    const button = document.getElementById("linuxdo-friends-profile-action");
    expect(controlItems.map((item) => item.textContent?.trim())).toEqual(["私信", "常规", "认可", "取消关注", "取消视奸"]);
    expect(button?.closest(".follow-button-container")).toBeNull();
    expect(button?.closest("li")?.className).toBe("linuxdo-friends-action-wrapper");
  });

  it("adds a friend action to a user card popover", async () => {
    window.history.replaceState({}, "", "/t/topic/1");
    document.body.innerHTML = `
      <aside class="user-card">
        <a class="user-card-avatar" href="/u/misaka7369">
          <img class="avatar" src="https://linux.do/user_avatar/linux.do/misaka7369/96/1.png" alt="">
        </a>
        <div class="names"><a class="name" href="/u/misaka7369">星</a><a class="username" href="/u/misaka7369">@Misaka7369</a></div>
        <ul class="usercard-controls">
          <li><button class="btn btn-primary">私信</button></li>
          <li class="follow-button-container"><div class="ember-view"><button class="btn">关注</button></div></li>
        </ul>
      </aside>
    `;
    const addedState = addFriendFromProfile(defaultAppState, {
      username: "misaka7369",
      name: "星",
      avatarUrl: "https://linux.do/user_avatar/linux.do/misaka7369/96/1.png",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    const sendMessage = vi.fn(async (message: unknown) => {
      if (isHeartbeatMessage(message)) return { ok: true };
      if (isGetStateMessage(message)) return { ok: true, data: defaultAppState };
      if (isAddFriendFromKnownUserMessage(message)) return { ok: true, data: addedState };
      return { ok: true, data: defaultAppState };
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    await import("./contentScript");
    await Promise.resolve();
    await Promise.resolve();

    const button = document.querySelector<HTMLButtonElement>('.user-card .linuxdo-friends-profile-action');
    expect(button?.id).toBe("");
    expect(button?.textContent).toBe("视奸");
    expect(button?.dataset.username).toBe("misaka7369");
    expect(button?.closest("li")?.className).toBe("linuxdo-friends-action-wrapper");
    expect(Array.from(document.querySelectorAll(".user-card .usercard-controls > li")).map((item) => item.textContent?.trim())).toEqual([
      "私信",
      "关注",
      "视奸"
    ]);

    button?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({
      type: "addFriendFromKnownUser",
      user: {
        username: "misaka7369",
        name: "星",
        avatarUrl: "https://linux.do/user_avatar/linux.do/misaka7369/96/1.png"
      }
    });
    expect(button?.textContent).toBe("取消视奸");
  });

  it("lets a user card friend action remove an existing friend", async () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "misaka7369",
      name: "星",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    window.history.replaceState({}, "", "/t/topic/1");
    document.body.innerHTML = `
      <aside class="user-card" data-username="Misaka7369">
        <div class="names"><span class="name">星</span><span class="username">@Misaka7369</span></div>
        <ul class="usercard-controls">
          <li><button class="btn">关注</button></li>
        </ul>
      </aside>
    `;
    const sendMessage = vi.fn(async (message: unknown) => {
      if (isHeartbeatMessage(message)) return { ok: true };
      if (isGetStateMessage(message)) return { ok: true, data: state };
      if (isRemoveFriendMessage(message)) return { ok: true, data: defaultAppState };
      return { ok: true, data: state };
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    await import("./contentScript");
    await Promise.resolve();
    await Promise.resolve();

    const button = document.querySelector<HTMLButtonElement>('.user-card .linuxdo-friends-profile-action');
    expect(button?.textContent).toBe("取消视奸");
    expect(button?.dataset.linuxdoFriendsActive).toBe("true");

    button?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({ type: "removeFriend", username: "misaka7369" });
    expect(button?.textContent).toBe("视奸");
  });

  it("injects a page launcher before the current-user header item and opens the native user menu friends tab", async () => {
    document.body.innerHTML = `
      <ul class="d-header-icons">
        <li class="header-dropdown-toggle locale-toggle"><button>ZH</button></li>
        <li class="header-dropdown-toggle current-user">
          <button id="toggle-current-user" class="current-user">me</button>
        </li>
      </ul>
    `;
    document.getElementById("toggle-current-user")?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `
          <div class="user-menu revamped menu-panel">
            <div class="panel-body">
              <div class="panel-body-contents">
                <div class="quick-access-panel">native notifications</div>
                <div class="menu-tabs-container" role="tablist">
                  <div class="top-tabs tabs-list">
                    <a id="user-menu-button-all-notifications" class="btn btn-flat btn-icon no-text user-menu-tab active" role="tab" aria-selected="true">native</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `
      );
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { ensureLauncher } = await import("./contentScript");
    ensureLauncher();
    const launcher = document.getElementById("linuxdo-friends-launcher") as HTMLButtonElement | null;

    expect(launcher).toBeTruthy();
    expect(launcher?.className).toContain("btn");
    expect(launcher?.className).toContain("btn-flat");
    expect(launcher?.querySelector("svg")?.className.baseVal).toContain("d-icon-user-group");
    expect(launcher?.querySelector("use")?.getAttribute("href")).toBe("#user-group");
    const headerItems = Array.from(document.querySelectorAll(".d-header-icons > li"));
    expect(headerItems.map((item) => item.className)).toEqual([
      "header-dropdown-toggle locale-toggle",
      "header-dropdown-toggle linuxdo-friends-header-item",
      "header-dropdown-toggle current-user"
    ]);
    expect(headerItems[1].querySelector("#linuxdo-friends-launcher")).toBe(launcher);

    launcher?.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const userMenuPanel = document.getElementById("linuxdo-friends-user-menu-panel");
    expect(userMenuPanel?.shadowRoot?.querySelector(".linuxdo-friends-menu-root")).toBeTruthy();
    expect(document.getElementById("linuxdo-friends-user-menu-tab")?.className).toContain("active");
    expect(document.querySelector("[id^='linuxdo-friends-panel-host'], .linuxdo-friends-inpage-root")).toBeNull();
  });

  it("falls back to direct insertion before a simple current-user button", async () => {
    document.body.innerHTML = '<div class="d-header-icons"><button class="current-user">me</button></div>';
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { ensureLauncher } = await import("./contentScript");
    ensureLauncher();

    const launcher = document.getElementById("linuxdo-friends-launcher") as HTMLButtonElement | null;
    expect(launcher).toBeTruthy();
    expect(document.querySelector(".d-header-icons")?.firstElementChild).toBe(launcher);
  });

  it("repositions the launcher when Discourse rebuilds the header after an early insertion", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="loading-header"></div>';
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { ensureLauncher } = await import("./contentScript");
    ensureLauncher();
    const launcher = document.getElementById("linuxdo-friends-launcher") as HTMLButtonElement | null;
    expect(launcher).toBeTruthy();
    expect(launcher?.parentElement).toBe(document.body);
    expect(launcher?.style.position).toBe("fixed");

    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <ul class="d-header-icons">
          <li class="header-dropdown-toggle locale-toggle"><button>ZH</button></li>
          <li class="header-dropdown-toggle current-user">
            <button id="toggle-current-user" class="current-user">me</button>
          </li>
        </ul>
      `
    );

    await vi.runOnlyPendingTimersAsync();
    const headerItems = Array.from(document.querySelectorAll(".d-header-icons > li"));
    expect(headerItems.map((item) => item.className)).toEqual([
      "header-dropdown-toggle locale-toggle",
      "header-dropdown-toggle linuxdo-friends-header-item",
      "header-dropdown-toggle current-user"
    ]);
    expect(headerItems[1].querySelector("#linuxdo-friends-launcher")).toBe(launcher);
    expect(launcher?.style.position).toBe("relative");
    expect(document.body.querySelector(":scope > #linuxdo-friends-launcher")).toBeNull();

    vi.useRealTimers();
  });

  it("sends page heartbeats and leaves the launcher indicator hidden when the extension responds", async () => {
    document.body.innerHTML = '<div class="d-header-icons"><button class="current-user">me</button></div>';
    const sendMessage = vi.fn(async (message: unknown) =>
      isHeartbeatMessage(message)
        ? { status: "connected", connectedCount: 1, staleCount: 0, heartbeats: [], updatedAt: new Date().toISOString() }
        : isGetPageScriptStatusMessage(message)
          ? { ok: true, data: { status: "connected", connectedCount: 1, staleCount: 0, heartbeats: [], updatedAt: new Date().toISOString() } }
          : { ok: true, data: defaultAppState }
    );
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { ensureLauncher } = await import("./contentScript");
    ensureLauncher();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "linuxdoFriends.pageHeartbeat",
        status: "ready",
        hasLauncher: expect.any(Boolean)
      })
    );
    const dot = document.querySelector<HTMLElement>("#linuxdo-friends-launcher .linuxdo-friends-launcher-status-dot");
    expect(dot?.textContent).toBe("×");
    expect(dot?.style.display).toBe("none");
  });

  it("refreshes the page heartbeat promptly when the page title changes", async () => {
    vi.useFakeTimers();
    document.title = "旧主题 - Linux.do";
    document.body.innerHTML = '<div class="d-header-icons"><button class="current-user">me</button></div>';
    const sendMessage = vi.fn(async (message: unknown) =>
      isHeartbeatMessage(message)
        ? { status: "connected", connectedCount: 1, staleCount: 0, heartbeats: [], updatedAt: new Date().toISOString() }
        : { ok: true, data: defaultAppState }
    );
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    await import("./contentScript");
    await flushContentScriptAsyncWork();
    sendMessage.mockClear();

    document.title = "过渡标题 - Linux.do";
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    document.title = "新主题 - Linux.do";
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(349);
    expect(heartbeatMessages(sendMessage)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);

    expect(heartbeatMessages(sendMessage)).toEqual([
      expect.objectContaining({
        type: "linuxdoFriends.pageHeartbeat",
        title: "新主题 - Linux.do"
      })
    ]);
    vi.useRealTimers();
  });

  it("shows a red x on the launcher only when page heartbeat delivery fails", async () => {
    document.body.innerHTML = '<div class="d-header-icons"><button class="current-user">me</button></div>';
    const sendMessage = vi.fn(async (message: unknown) => {
      if (isHeartbeatMessage(message)) throw new Error("runtime disconnected");
      return { ok: true, data: defaultAppState };
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { ensureLauncher } = await import("./contentScript");
    ensureLauncher();
    await Promise.resolve();
    await Promise.resolve();

    const dot = document.querySelector<HTMLElement>("#linuxdo-friends-launcher .linuxdo-friends-launcher-status-dot");
    expect(dot?.textContent).toBe("×");
    expect(dot?.style.display).toBe("grid");
    expect(dot?.style.color).toBe("rgb(239, 68, 68)");
  });

  it("adds a friends tab to the user avatar menu and mounts the in-page app inside it", async () => {
    document.documentElement.dataset.theme = "light";
    document.body.innerHTML = `
      <div class="user-menu revamped menu-panel">
        <div class="panel-body">
          <div class="panel-body-contents">
            <div class="quick-access-panel">native notifications</div>
            <div class="menu-tabs-container" role="tablist">
              <div class="top-tabs tabs-list">
                <a id="user-menu-button-all-notifications" class="btn btn-flat btn-icon no-text user-menu-tab active" role="tab" aria-selected="true">native</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { enhanceUserMenu } = await import("./contentScript");
    enhanceUserMenu();
    const tab = document.getElementById("linuxdo-friends-user-menu-tab") as HTMLButtonElement | null;
    expect(tab).toBeTruthy();

    tab?.click();
    await Promise.resolve();
    await Promise.resolve();

    const panel = document.getElementById("linuxdo-friends-user-menu-panel");
    const nativePanel = document.querySelector<HTMLElement>(".quick-access-panel");
    const pageStyle = document.getElementById("linuxdo-friends-page-style")?.textContent ?? "";
    const menuRoot = panel?.shadowRoot?.querySelector<HTMLElement>(".linuxdo-friends-menu-root");
    expect(menuRoot).toBeTruthy();
    expect(menuRoot?.dataset.linuxdoFriendsTheme).toBe("light");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain(".linuxdo-friends-menu-root .modal-backdrop");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("position: absolute");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("overflow-y: auto");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("height: auto");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("color-scheme: inherit");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("background: var(--app-bg)");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain(".linuxdo-friends-menu-root .modal-head .icon-button");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("grid-column: 2");
    expect(panel?.shadowRoot?.querySelector("style")?.textContent).toContain("grid-row: 1");
    expect(panel?.previousElementSibling?.className).toContain("menu-tabs-container");
    expect(tab?.querySelector("svg")?.className.baseVal).toContain("d-icon-user-group");
    expect(tab?.querySelector("use")?.getAttribute("href")).toBe("#user-group");
    expect(pageStyle).not.toContain("#linuxdo-friends-user-menu-tab svg");
    expect(nativePanel?.style.display).toBe("none");
    expect(tab?.className).toContain("active");
    expect(document.getElementById("user-menu-button-all-notifications")?.className).not.toContain("active");
  });

  it("updates the mounted in-page app theme when the page theme syncs", async () => {
    document.documentElement.dataset.theme = "light";
    document.body.innerHTML = `
      <div class="user-menu revamped menu-panel">
        <div class="panel-body">
          <div class="panel-body-contents">
            <div class="menu-tabs-container" role="tablist">
              <div class="top-tabs tabs-list">
                <a id="user-menu-button-all-notifications" class="btn btn-flat btn-icon no-text user-menu-tab active" role="tab" aria-selected="true">native</a>
              </div>
            </div>
            <div class="quick-access-panel">native notifications</div>
          </div>
        </div>
      </div>
    `;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { enhanceUserMenu, syncPageTheme } = await import("./contentScript");
    enhanceUserMenu();
    document.getElementById("linuxdo-friends-user-menu-tab")?.click();
    await Promise.resolve();
    await Promise.resolve();
    const menuRoot = document
      .getElementById("linuxdo-friends-user-menu-panel")
      ?.shadowRoot?.querySelector<HTMLElement>(".linuxdo-friends-menu-root");
    expect(menuRoot?.dataset.linuxdoFriendsTheme).toBe("light");

    document.documentElement.dataset.theme = "dark";
    syncPageTheme();

    expect(menuRoot?.dataset.linuxdoFriendsTheme).toBe("dark");
  });

  it("adapts the friends tab panel to Discourse narrow slide-in user drawers", async () => {
    document.body.innerHTML = `
      <div class="user-menu revamped menu-panel show-avatars slide-in">
        <div class="panel-body">
          <div class="panel-body-contents">
            <div class="menu-tabs-container" role="tablist">
              <div class="top-tabs tabs-list">
                <a id="user-menu-button-all-notifications" class="btn btn-flat btn-icon no-text user-menu-tab active" role="tab" aria-selected="true">native</a>
              </div>
            </div>
            <div class="quick-access-panel">native notifications</div>
          </div>
        </div>
      </div>
    `;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn()
        }
      },
      storage: {
        local: createMockLocalStorage(),
        onChanged: {
          addListener: vi.fn()
        }
      }
    });

    const { enhanceUserMenu } = await import("./contentScript");
    enhanceUserMenu();
    const tab = document.getElementById("linuxdo-friends-user-menu-tab") as HTMLButtonElement | null;

    tab?.click();
    await Promise.resolve();
    await Promise.resolve();

    const menu = document.querySelector<HTMLElement>(".user-menu");
    const panel = document.getElementById("linuxdo-friends-user-menu-panel");
    const pageStyle = document.getElementById("linuxdo-friends-page-style")?.textContent ?? "";
    expect(menu?.className).toContain("linuxdo-friends-user-menu-active");
    expect(menu?.className).toContain("linuxdo-friends-user-menu-drawer");
    expect(panel?.previousElementSibling?.className).toContain("menu-tabs-container");
    expect(pageStyle).toContain(".user-menu.linuxdo-friends-user-menu-active.linuxdo-friends-user-menu-drawer #linuxdo-friends-user-menu-panel");
    expect(pageStyle).toContain("width: calc(100% - 46px)");
  });

  it("extracts the current account without requesting following users", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ topic_list: { topics: [] } }), {
          status: 200,
          headers: { "x-discourse-username": "LaFish" }
        })
      )
    );

    await import("./contentScript");
    expect(listener).toBeTruthy();
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractCurrentAccount" }, {}, resolve);
    });

    expect(response).toMatchObject({ ok: true, username: "lafish", requestCount: 1 });
    expect((response as { requestAttemptedAts?: string[] }).requestAttemptedAts).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/latest.json", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("extracts following users through same-origin page requests", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ topic_list: { topics: [] } }), {
            status: 200,
            headers: { "x-discourse-username": "LaFish" }
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([{ username: "Neil", name: "Neil", avatar_template: "/user_avatar/linux.do/neil/{size}/1.png" }]),
            { status: 200 }
          )
        )
    );

    await import("./contentScript");
    expect(listener).toBeTruthy();
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractFollowing" }, {}, resolve);
    });

    expect(response).toMatchObject({
      ok: true,
      username: "lafish",
      requestCount: 2,
      users: [
        {
          username: "Neil",
          name: "Neil",
          avatarUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png"
        }
      ]
    });
    expect((response as { requestAttemptedAts?: string[] }).requestAttemptedAts).toHaveLength(2);
    expect(fetch).toHaveBeenNthCalledWith(1, "/latest.json", expect.objectContaining({ credentials: "same-origin" }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/u/lafish/follow/following.json", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("extracts a user profile through a same-origin page request", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    const profilePayload = {
      user: {
        username: "Misaka7369",
        name: "御坂",
        avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png",
        last_posted_at: "2026-06-28T00:10:00.000Z",
        last_seen_at: "2026-06-28T00:12:00.000Z"
      }
    };
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(profilePayload), { status: 200 })));

    await import("./contentScript");
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractProfile", username: "Misaka7369" }, {}, resolve);
    });

    expect(response).toMatchObject({
      ok: true,
      requestCount: 1,
      profile: {
        username: "misaka7369",
        name: "御坂",
        avatarUrl: "https://linux.do/user_avatar/linux.do/misaka7369/48/1.png",
        lastPostedAt: "2026-06-28T00:10:00.000Z",
        lastSeenAt: "2026-06-28T00:12:00.000Z"
      }
    });
    expect((response as { requestAttemptedAts?: string[] }).requestAttemptedAts).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/u/misaka7369.json", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("keeps page profile extraction aligned with the direct profile parser", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    const profilePayload = {
      user: {
        username: "Misaka7369",
        name: "御坂",
        avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png",
        last_posted_at: "2026-06-28T00:10:00.000Z",
        last_seen_at: "2026-06-28T00:12:00.000Z"
      }
    };
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(profilePayload), { status: 200 })));

    await import("./contentScript");
    const response = await new Promise<{ ok: true; profile: ReturnType<typeof extractFriendProfile> }>((resolve) => {
      listener?.({ type: "linuxdoFriends.extractProfile", username: "Misaka7369" }, {}, (value: unknown) => {
        resolve(value as { ok: true; profile: ReturnType<typeof extractFriendProfile> });
      });
    });
    const direct = extractFriendProfile(profilePayload);

    expect(response.ok).toBe(true);
    expect({ ...response.profile, refreshedAt: "stable" }).toEqual({ ...direct, refreshedAt: "stable" });
  });

  it("extracts avatars as data URLs through same-origin page requests", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "image/png" }),
          blob: async () => new Blob(["abc"], { type: "image/png" })
        } as Response
      )
    );

    await import("./contentScript");
    const response = await new Promise((resolve) => {
      listener?.(
        {
          type: "linuxdoFriends.extractAvatar",
          username: "Neil",
          avatarUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png"
        },
        {},
        resolve
      );
    });

    expect(response).toMatchObject({
      ok: true,
      username: "neil",
      sourceUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
      contentType: "image/png",
      byteLength: 3,
      requestCount: 1
    });
    expect((response as { dataUrl?: string }).dataUrl).toMatch(/^data:image\/png;base64,/);
    expect((response as { requestAttemptedAts?: string[] }).requestAttemptedAts).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/user_avatar/linux.do/neil/48/1.png", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("rejects avatar extraction for non-linux.do image URLs", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn());

    await import("./contentScript");
    const response = await new Promise((resolve) => {
      listener?.(
        {
          type: "linuxdoFriends.extractAvatar",
          username: "Neil",
          avatarUrl: "https://example.com/avatar.png"
        },
        {},
        resolve
      );
    });

    expect(response).toMatchObject({ ok: false, reason: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("extracts friend activity through same-origin page requests", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              user_actions: []
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              user_actions: [
                {
                  id: 42,
                  action_type: 5,
                  topic_title: "一个近况",
                  created_at: "2026-06-27T00:00:02.000Z",
                  topic_id: 99,
                  post_id: 42,
                  post_url: "/t/example/42/1",
                  acting_username: "Misaka7369"
                }
              ]
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              boosts: [
                {
                  id: 43,
                  created_at: "2026-06-27T00:00:01.000Z",
                  user: { username: "Misaka7369" },
                  post: { topic_title: "一个 boost", id: 43 }
                }
              ]
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                id: 44,
                created_at: "2026-06-27T00:00:00.000Z",
                user: { username: "Misaka7369" },
                post: { topic_title: "一个 reaction", id: 44 },
                reaction: { reaction_value: "hugs" }
              }
            ]),
            { status: 200 }
          )
        )
    );

    await import("./contentScript");
    expect(listener).toBeTruthy();
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractActivity", username: "Misaka7369" }, {}, resolve);
    });

    expect(response).toMatchObject({
      ok: true,
      requestCount: 4,
      activity: {
        username: "misaka7369",
        items: [
          {
            id: "user_action:misaka7369:5:99:42",
            username: "misaka7369",
            kind: "reply",
            title: "一个近况",
            url: "/t/example/42/1"
          },
          { id: "boost:43", kind: "boost", title: "一个 boost" },
          { id: "reaction:44", kind: "reaction", reactionValue: "hugs" }
        ]
      }
    });
    expect((response as { requestAttemptedAts?: string[] }).requestAttemptedAts).toHaveLength(4);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/user_actions.json?offset=0&username=misaka7369&filter=4",
      expect.objectContaining({ credentials: "same-origin" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/user_actions.json?offset=0&username=misaka7369&filter=5",
      expect.objectContaining({ credentials: "same-origin" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/discourse-boosts/users/misaka7369/boosts-given.json",
      expect.objectContaining({ credentials: "same-origin" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "/discourse-reactions/posts/reactions.json?username=misaka7369",
      expect.objectContaining({ credentials: "same-origin" })
    );
  });

  it.each([
    ["topic", "/user_actions.json?offset=0&username=misaka7369&filter=4"],
    ["reply", "/user_actions.json?offset=0&username=misaka7369&filter=5"],
    ["boost", "/discourse-boosts/users/misaka7369/boosts-given.json"],
    ["reaction", "/discourse-reactions/posts/reactions.json?username=misaka7369"]
  ] as const)("extracts only the scoped %s activity endpoint", async (kind, expectedPath) => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    const payload =
      kind === "boost"
        ? { boosts: [{ id: 1, user: { username: "Misaka7369" }, post: { topic_title: "boost" } }] }
        : kind === "reaction"
          ? [{ id: 1, user: { username: "Misaka7369" }, post: { topic_title: "reaction" }, reaction: { reaction_value: "hugs" } }]
          : { user_actions: [{ action_type: kind === "topic" ? 4 : 5, topic_id: 1, title: kind, acting_username: "Misaka7369" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 })));

    await import("./contentScript");
    const response = await new Promise<{ ok: true; activity: ReturnType<typeof normalizeFriendActivity> }>((resolve) => {
      listener?.({ type: "linuxdoFriends.extractActivity", username: "Misaka7369", kind }, {}, (value: unknown) => {
        resolve(value as { ok: true; activity: ReturnType<typeof normalizeFriendActivity> });
      });
    });

    expect(response.ok).toBe(true);
    expect((response as { requestCount?: number }).requestCount).toBe(1);
    expect(response.activity.items).toHaveLength(1);
    expect(response.activity.items[0].kind).toBe(kind);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expectedPath, expect.objectContaining({ credentials: "same-origin" }));
  });

  it("executes the activity step planned by the background page", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ boosts: [{ id: 1, user: { username: "Misaka7369" }, post: { topic_title: "boost" } }] }), { status: 200 })
      )
    );

    await import("./contentScript");
    const response = await new Promise<{ ok: true; activity: ReturnType<typeof normalizeFriendActivity> }>((resolve) => {
      listener?.(
        {
          type: "linuxdoFriends.extractActivity",
          username: "Misaka7369",
          step: { kind: "boost", path: "/discourse-boosts/users/misaka7369/boosts-given.json" }
        },
        {},
        (value: unknown) => resolve(value as { ok: true; activity: ReturnType<typeof normalizeFriendActivity> })
      );
    });

    expect(response.ok).toBe(true);
    expect((response as { requestCount?: number }).requestCount).toBe(1);
    expect(response.activity.items[0].kind).toBe("boost");
    expect(fetch).toHaveBeenCalledWith("/discourse-boosts/users/misaka7369/boosts-given.json", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("rejects activity step paths that are not relative linux.do json paths", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn());

    await import("./contentScript");
    expect(listener).toBeTruthy();
    const handleMessage = listener as unknown as (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean;
    const accepted = handleMessage(
      {
        type: "linuxdoFriends.extractActivity",
        username: "Misaka7369",
        step: { kind: "boost", path: "https://example.com/boosts-given.json" }
      },
      {},
      () => undefined
    );

    expect(accepted).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps page extraction semantics aligned with the direct normalization path", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    const userActionsPayload = {
      user_actions: [
        {
          action_type: 4,
          topic_id: 99,
          post_number: 1,
          created_at: "2026-06-27T00:00:03.000Z",
          acting_username: "Misaka7369",
          acting_name: "星",
          acting_avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png",
          title: "一个主题",
          excerpt: "<p>hello&nbsp;topic</p>"
        }
      ]
    };
    const boostsPayload = {
      boosts: [
        {
          id: 43,
          raw: "<p>boost text</p>",
          created_at: "2026-06-27T00:00:02.000Z",
          user: { username: "Misaka7369", name: "星", avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png" },
          post: { topic_title: "一个 boost", id: 43, username: "lafish", excerpt: "<strong>boosted</strong>" }
        }
      ]
    };
    const reactionsPayload = [
      {
        id: 44,
        created_at: "2026-06-27T00:00:01.000Z",
        user: { username: "Misaka7369", name: "星", avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1.png" },
        post: { topic_title: "一个 reaction", id: 44, username: "lafish", excerpt: "reacted" },
        reaction: { reaction_value: "hugs" }
      }
    ];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(userActionsPayload), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(userActionsPayload), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(boostsPayload), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(reactionsPayload), { status: 200 }))
    );

    await import("./contentScript");
    const response = await new Promise<{ ok: true; activity: ReturnType<typeof normalizeFriendActivity> }>((resolve) => {
      listener?.({ type: "linuxdoFriends.extractActivity", username: "Misaka7369" }, {}, (value: unknown) => {
        resolve(value as { ok: true; activity: ReturnType<typeof normalizeFriendActivity> });
      });
    });
    const direct = normalizeFriendActivity("Misaka7369", {
      userActions: extractUserActions(userActionsPayload),
      boosts: extractBoosts(boostsPayload),
      reactions: extractReactions(reactionsPayload)
    });

    expect(response.ok).toBe(true);
    expect(response.activity.items).toEqual(direct.items);
    expect(response.activity.lastPostAt).toEqual(direct.lastPostAt);
    expect(response.activity.coarseStatus).toEqual(direct.coarseStatus);
  });

  it("stops activity extraction when any endpoint returns a challenge", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ user_actions: [] }), { status: 200 }))
        .mockResolvedValueOnce(new Response("Enable JavaScript and cookies to continue", { status: 429 }))
    );

    await import("./contentScript");
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractActivity", username: "Misaka7369" }, {}, resolve);
    });

    expect(response).toMatchObject({ ok: false, reason: "challenge" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops profile extraction when the profile endpoint returns a challenge", async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, data: defaultAppState })),
        onMessage: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      },
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("Enable JavaScript and cookies to continue", { status: 429 })));

    await import("./contentScript");
    const response = await new Promise((resolve) => {
      listener?.({ type: "linuxdoFriends.extractProfile", username: "Misaka7369" }, {}, resolve);
    });

    expect(response).toMatchObject({ ok: false, reason: "challenge" });
    expect(fetch).toHaveBeenCalledWith("/u/misaka7369.json", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("navigates linux.do activity links through an in-site click before falling back to assign", async () => {
    const clickLink = vi.fn();
    const assign = vi.fn();
    const { navigateInPage } = await import("./contentScript");

    const response = await navigateInPage("https://linux.do/t/topic/1/2", {
      currentHref: () => "https://linux.do/latest",
      clickLink,
      assign,
      delay: async () => undefined
    });

    expect(response).toEqual({ ok: true, url: "https://linux.do/t/topic/1/2" });
    expect(clickLink).toHaveBeenCalledWith("/t/topic/1/2");
    expect(assign).toHaveBeenCalledWith("https://linux.do/t/topic/1/2");
  });

  it("does not fall back to assign when the in-site click changes location", async () => {
    const clickLink = vi.fn();
    const assign = vi.fn();
    const { navigateInPage } = await import("./contentScript");

    const response = await navigateInPage("/t/topic/1/2", {
      currentHref: vi.fn().mockReturnValueOnce("https://linux.do/latest").mockReturnValueOnce("https://linux.do/t/topic/1/2"),
      clickLink,
      assign,
      delay: async () => undefined
    });

    expect(response).toEqual({ ok: true, url: "https://linux.do/t/topic/1/2" });
    expect(clickLink).toHaveBeenCalledWith("/t/topic/1/2");
    expect(assign).not.toHaveBeenCalled();
  });

  it("rejects in-page navigation outside linux.do", async () => {
    const { navigateInPage } = await import("./contentScript");

    await expect(navigateInPage("https://example.com/t/topic/1")).resolves.toMatchObject({ ok: false, reason: "unavailable" });
  });
});

function createMockLocalStorage() {
  const store = new Map<string, unknown>();
  return {
    async get(key: string) {
      return { [key]: store.get(key) };
    },
    async set(values: Record<string, unknown>) {
      for (const [key, value] of Object.entries(values)) {
        store.set(key, value);
      }
    }
  };
}

async function waitForFriendMark(selector: string) {
  for (let index = 0; index < 20; index += 1) {
    await flushContentScriptAsyncWork();
    await vi.advanceTimersByTimeAsync(100);
    if (document.querySelector(selector)?.querySelector(".linuxdo-friends-name-mark")) return;
  }
  throw new Error(`Friend mark not found: ${selector}`);
}

async function flushContentScriptAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

function isHeartbeatMessage(value: unknown): boolean {
  return typeof value === "object" && value != null && (value as { type?: unknown }).type === "linuxdoFriends.pageHeartbeat";
}

function heartbeatMessages(sendMessage: ReturnType<typeof vi.fn>): unknown[] {
  return sendMessage.mock.calls.map(([message]) => message).filter(isHeartbeatMessage);
}

function isGetPageScriptStatusMessage(value: unknown): boolean {
  return typeof value === "object" && value != null && (value as { type?: unknown }).type === "getPageScriptStatus";
}

function isGetStateMessage(value: unknown): boolean {
  return typeof value === "object" && value != null && (value as { type?: unknown }).type === "getState";
}

function isAddFriendFromKnownUserMessage(value: unknown): boolean {
  return typeof value === "object" && value != null && (value as { type?: unknown }).type === "addFriendFromKnownUser";
}

function isRemoveFriendMessage(value: unknown): boolean {
  return typeof value === "object" && value != null && (value as { type?: unknown }).type === "removeFriend";
}
