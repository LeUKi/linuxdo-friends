# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-19
- Primary product surfaces: Chrome side panel, options/settings page, linux.do profile page integration, linux.do user card integration, and read-only topic-detail post metadata integration.
- Evidence reviewed: `README.md`; `docs/privacy-policy.md`; `docs/chrome-web-store-submission.md`; `docs/linuxdo-friends-extension-feasibility.md`; `src/app/FriendsApp.tsx`; `src/app/FriendManagement.tsx`; `src/content/contentScript.ts`; `src/styles/app.css`; `src/shared/types.ts`; `src/domain/configTransfer.ts`.

## Brand

- Personality: Quiet, practical, community-native, and work-focused.
- Trust signals: Local-first storage, explicit refresh behavior, clear optional integrations, no Cloudflare bypass, no Cookie export, no remote linux.do proxy.
- Avoid: Tracker/monitor language, marketing-heavy visuals, decorative gradients/orbs, crowded chrome, and UI that implies hidden surveillance.

## Product goals

- Goals: Help users maintain a focused linux.do friend view, understand recent public activity, and keep personal relationship context through notes.
- Non-goals: Real-time online tracking, non-friend note management, note search, grouping changes, pinning changes, notes in topic lists/search/notifications/chat/directories/reaction overlays/quotes/mentions, or new cloud-sync timing.
- Success signals: Users can scan friends quickly, edit notes from the surfaces where friend context appears, and long notes never disturb surrounding layouts.

## Personas and jobs

- Primary personas: linux.do users who maintain a set of important followed accounts.
- User jobs: Promote followed users into friends, refresh visible public activity, review friend status, add or clear short private notes, and migrate settings between browser profiles.
- Key contexts of use: Narrow browser side panel, full settings page, active linux.do user profile pages, transient linux.do user hover cards, topic-detail post headers, light and dark linux.do themes.

## Information architecture

- Primary navigation: The side panel is the main daily surface; the options page owns configuration and full friend management; linux.do page injections provide contextual actions.
- Core routes/screens: Friends list, activity feed, Lao Finds, settings scope management, cloud backup settings, profile action area, user card action area, and `/t/...` post author metadata.
- Content hierarchy: Identity first; profile and user-card surfaces place a dedicated editable note row below identity, topic posts place a non-empty read-only note directly after the display-name link, and the compact quick-add list keeps notes behind a stateful pencil control to preserve row width.

## Design principles

- Principle 1: Preserve the host page and extension layout before adding context.
- Principle 2: Make private user-owned data visible only where it helps the current task. Topic post notes can appear in screenshots or screen sharing, so their exposure must stay limited to the approved `/t/...` author-name surface.
- Tradeoffs: Notes are constrained to a single preview line instead of expanding cards. Full text is available through overflow-only preview, while editing remains on the adjacent pencil control.

## Visual language

- Color: Reuse existing CSS variables and the restrained teal accent already used by the extension. Injected profile, user-card, and topic-post note text uses `var(--accent-strong)`; empty profile/user-card placeholders use a 64% accent mix. Side-panel/settings notes remain muted and full-note tooltips retain the normal strong text color.
- Typography: Match existing system UI sizing; use compact labels inside side panels, rows, menus, and injected controls.
- Spacing/layout rhythm: Keep dense but readable rows with predictable gaps and stable action positions.
- Shape/radius/elevation: Keep cards, controls, and modals at 8px radius or less unless an existing component already has a narrower rule; use elevation sparingly for overlays.
- Motion: Keep motion subtle and disable nonessential animation under `prefers-reduced-motion`.
- Imagery/iconography: Use the existing extension icon language and lucide icons for in-extension controls where available; use text-compatible injected controls on linux.do surfaces.

## Components

- Existing components to reuse: `FriendsApp`, `FriendCandidateList`, `ActivityScopeSelect`, `UserIdentityRow`, shared modal/button/list styling, and content-script Shadow DOM roots.
- New/changed components: `FriendNotePreview` for constrained one-line note display; `FriendNoteEditButton` for the shared pencil, full-note tooltip, and edit trigger across extension and injected surfaces; one shared fixed-position tooltip portal; one shared note editor dialog reused by settings, the side-panel quick-add list, profile, and user-card surfaces; one profile/user-card note row containing preview or placeholder plus an adjacent pencil control; one read-only topic-post preview root per visible floor.
- Variants and states: Side panel and user card note previews cap at `240px`; settings cap at `280px`; profile caps at `420px`; topic-post previews cap at `min(160px, 40vw)`. Page-injected profile, user-card, and topic-post notes use `var(--accent-strong)`, while plugin surfaces keep their muted hierarchy. Every preview variant uses `min-width: 0`, `width: fit-content`, and single-line ellipsis without resizing parent grids or card height. Profile and user-card note rows sit inside the identity names container on their own line. Their pencils keep the existing subtle default and accent hover/focus styling, and always show a non-empty note in full on hover or focus. Topic-post notes appear only for non-empty friend notes after `.full-name > a[data-user-card]`, with no placeholder, separator, background, pencil, or edit action. The side-panel quick-add list never renders note text inline: existing friends get a fixed pencil beside Remove, with `var(--text-strong)` when a note exists and `var(--text-subtle)` when empty.
- Token/component ownership: Keep reusable React UI in `src/app/` or adjacent shared UI helpers; keep content-script-only DOM/CSS behavior isolated inside `src/content/`; use `src/styles/app.css` and existing CSS variables for extension surfaces.

## Accessibility

- Target standard: Keyboard-usable, readable, and nonblocking for Chrome extension and injected linux.do surfaces.
- Keyboard/focus behavior: Note previews show the full-text overlay on focus only when truncated; quick-add, profile, and user-card pencils show any existing note in full on hover or focus; Escape closes overlays and editors; Enter saves in the note editor.
- Contrast/readability: Maintain existing light/dark theme contrast. Page-injected note previews use the synchronized accent token; plugin previews and full-note tooltips preserve their quieter, high-readability text colors.
- Screen-reader semantics: Preview text remains text; topic-post notes stay read-only; edit controls expose a clear note-editing label; dialogs announce title, validation, character count, and error state.
- Reduced motion and sensory considerations: Do not animate note preview, tooltip, or editor in a way required for comprehension.

## Responsive behavior

- Supported breakpoints/devices: Chrome side panel width, full options page desktop width, narrow browser windows, linux.do desktop hover, and touch-capable devices.
- Layout adaptations: Long Chinese text, continuous English, emoji, and long URLs stay within the configured surface width and use single-line ellipsis in preview. Topic notes must not change floor-header height.
- Touch/hover differences: Desktop hover and keyboard focus can show overflow text, and editable note pencils always show an existing note in full. Touching an editable pencil opens the editor directly; other touch previews open full text on tap and close on outside tap or Escape.

## Interaction states

- Loading: Keep existing row and action loading states; do not block note viewing during unrelated refresh work.
- Empty: Empty or whitespace-only profile/user-card notes show `视奸备注` in `color-mix(in srgb, var(--accent-strong) 64%, var(--text-subtle))` with an adjacent subdued pencil; either opens the editor. The quick-add list shows only a subdued pencil and no placeholder or empty tooltip. Topic posts render nothing for empty notes or username-only identities. Clearing a note is valid.
- Error: Failed save keeps the editor open with the draft and an error message.
- Success: Saved notes immediately update local state and archive-difference indicators through existing state flow.
- Disabled: Disable save while submitting or when the user is no longer a friend.
- Offline/slow network, if applicable: Note saves are local/background state updates; cloud upload timing remains unchanged and should not run on each keystroke or save.

## Content voice

- Tone: Short, direct Chinese UI copy that fits compact controls.
- Terminology: Use "佬朋友", "备注", "保存", "取消", "清除", "视奸", and "云存档" consistently with existing UI.
- Microcopy rules: Prefer action labels over explanations; use `视奸备注` only as the empty contextual editing prompt; show validation and save errors only when action is required.

## Implementation constraints

- Framework/styling system: TypeScript, React, Jotai, MV3 content scripts, Vite, and repo CSS variables.
- Design-token constraints: Do not introduce a new design-system layer or dependency. Extend existing CSS files and local helpers.
- Performance constraints: Preview overflow detection should be measurement-based (`scrollWidth > clientWidth`) and event-driven, not continuous polling; editable pencils do not measure overflow because their tooltip intentionally shows any non-empty note in full.
- Compatibility constraints: Keep config schema v1, `FriendUser.note`, config export/import, and cloud archive payload shape unchanged. Do not add permissions, background commands, or remote services for notes.
- Test/screenshot expectations: Verify note constraints across the side-panel friend list and quick-add manager, settings, profile, user card, and topic-post author names; confirm editable pencils expose full notes on hover/focus, the quick-add list stays compact, and excluded dense surfaces remain untouched; verify content-script bundle stays self-contained with no top-level import/export remnants.

## Open questions

- None for the friend-note feature as of 2026-08-18.
