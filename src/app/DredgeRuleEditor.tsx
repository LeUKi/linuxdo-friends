import React, { useEffect, useMemo, useState } from "react";
import { ALL_ACTIVITY_KINDS } from "../domain/friends";
import { validateDredgeRulePattern } from "../domain/laoFinds";
import type { ActivityRefreshKind, AppState, DredgeRule, DredgeRuleMode, Username } from "../shared/types";
import { deriveFeedUserOptions, deriveDredgeRuleScopeWarning } from "../popup/selectors";
import { kindText } from "./activityKinds";

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type DraftKind = "create" | "edit";

interface DredgeRuleDraft {
  kind: DraftKind;
  id?: string;
  name: string;
  enabled: boolean;
  mode: DredgeRuleMode;
  usernames: "all" | Username[];
  kinds: ActivityRefreshKind[];
  patternText: string;
}

export function DredgeRuleEditor({
  locked = false,
  lockReason,
  onRemoveRule,
  onUpsertRule,
  rules,
  state
}: {
  locked?: boolean;
  lockReason?: string;
  onRemoveRule: (id: string) => void;
  onUpsertRule: (rule: Partial<DredgeRule> & { id?: string }) => void;
  rules: DredgeRule[];
  state: AppState;
}) {
  const users = useMemo(() => deriveFeedUserOptions(state), [state]);
  const [draft, setDraft] = useState<DredgeRuleDraft | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  function beginCreate() {
    if (locked) return;
    if (draft) {
      setMessage("请先保存或取消当前草稿。");
      return;
    }
    setDraft({
      kind: "create",
      name: "新打捞规则",
      enabled: true,
      mode: "allow",
      usernames: "all",
      kinds: ALL_ACTIVITY_KINDS,
      patternText: ""
    });
    setMessage(undefined);
  }

  function beginEdit(rule: DredgeRule) {
    if (locked) return;
    if (draft && draft.id !== rule.id) {
      setMessage("请先保存或取消当前草稿。");
      return;
    }
    setDraft(draftFromRule(rule));
    setMessage(undefined);
  }

  function closeDraft() {
    setDraft(undefined);
    setMessage(undefined);
  }

  function saveDraft() {
    if (!draft || locked) return;
    const patterns = patternsFromText(draft.patternText);
    for (const pattern of patterns) {
      const error = validateDredgeRulePattern(pattern);
      if (error) {
        setMessage(`正则表达式无效：${pattern}`);
        return;
      }
    }
    onUpsertRule({
      schemaVersion: 2,
      id: draft.id,
      name: draft.name,
      enabled: draft.enabled,
      mode: draft.mode,
      usernames: draft.usernames,
      kinds: draft.kinds,
      patterns
    });
    setDraft(undefined);
    setMessage(undefined);
  }

  useEffect(() => {
    if (!draft) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDraft();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft]);

  return (
    <section className={classNames("panel settings-card dredge-rule-panel")}>
      <div className={classNames("finds-section-head")}>
        <div>
          <h2>打捞规则</h2>
          <p>允许规则负责收集，屏蔽规则全局拦截；修改需要显式保存。</p>
        </div>
        <button className={classNames("small-action")} type="button" onClick={beginCreate} disabled={locked || Boolean(draft)}>
          新建
        </button>
      </div>
      {locked && lockReason ? <p className="dredge-rule-lock">{lockReason}</p> : null}
      {rules.length === 0 ? (
        <p className={classNames("empty finds-empty")}>当前没有打捞规则；新建规则后再开始打捞。</p>
      ) : (
        <div className={classNames("dredge-rule-list")}>
          {rules.map((rule) => (
            <DredgeRuleRow
              deleteDisabled={Boolean(draft)}
              key={rule.id}
              locked={locked}
              rule={rule}
              state={state}
              onEdit={() => beginEdit(rule)}
              onRemoveRule={onRemoveRule}
            />
          ))}
        </div>
      )}
      {draft ? (
        <DredgeRuleDraftModal
          draft={draft}
          locked={locked}
          message={message}
          state={state}
          users={users}
          onCancel={closeDraft}
          onChange={setDraft}
          onClose={closeDraft}
          onSave={saveDraft}
        />
      ) : null}
    </section>
  );
}

function DredgeRuleRow({
  deleteDisabled,
  locked,
  onEdit,
  onRemoveRule,
  rule,
  state
}: {
  deleteDisabled: boolean;
  locked: boolean;
  onEdit: () => void;
  onRemoveRule: (id: string) => void;
  rule: DredgeRule;
  state: AppState;
}) {
  const warning = deriveDredgeRuleScopeWarning(state, rule);
  return (
    <article className={classNames("dredge-rule-row")}>
      <div className={classNames("dredge-rule-row-main")}>
        <div className={classNames("dredge-rule-row-title")}>
          <strong>{rule.name}</strong>
          <span className={classNames("dredge-rule-badge", `is-${rule.mode}`)}>{rule.mode === "block" ? "屏蔽" : "允许"}</span>
          <span className={classNames("dredge-rule-badge", rule.enabled ? "is-enabled" : "is-disabled")}>{rule.enabled ? "已启用" : "已停用"}</span>
        </div>
        <div className={classNames("dredge-rule-summary")}>
          <span>{summarizeUsers(rule.usernames)}</span>
          <span>{summarizeKinds(rule.kinds)}</span>
          <span>{summarizePatterns(rule.patterns)}</span>
        </div>
        {warning ? <p className={classNames("dredge-rule-warning compact")}>{warning}</p> : null}
      </div>
      <div className={classNames("dredge-rule-row-actions")}>
        <button className={classNames("small-action")} type="button" onClick={onEdit} disabled={locked}>
          编辑
        </button>
        <button className={classNames("danger-action")} type="button" onClick={() => onRemoveRule(rule.id)} disabled={locked || deleteDisabled}>
          删除
        </button>
      </div>
    </article>
  );
}

function DredgeRuleDraftModal({
  draft,
  locked,
  message,
  onCancel,
  onChange,
  onClose,
  onSave,
  state,
  users
}: {
  draft: DredgeRuleDraft;
  locked: boolean;
  message?: string;
  onCancel: () => void;
  onChange: (draft: DredgeRuleDraft) => void;
  onClose: () => void;
  onSave: () => void;
  state: AppState;
  users: ReturnType<typeof deriveFeedUserOptions>;
}) {
  const selectedUsers = draft.usernames === "all" ? [] : draft.usernames;
  const warning = deriveDredgeRuleScopeWarning(state, draft);

  function patch(next: Partial<DredgeRuleDraft>) {
    onChange({ ...draft, ...next });
  }

  function toggleKind(kind: ActivityRefreshKind) {
    const kinds = draft.kinds.includes(kind)
      ? draft.kinds.filter((item) => item !== kind)
      : ALL_ACTIVITY_KINDS.filter((item) => item === kind || draft.kinds.includes(item));
    patch({ kinds: kinds.length ? kinds : ALL_ACTIVITY_KINDS });
  }

  function toggleUsername(username: Username) {
    if (draft.usernames === "all") {
      patch({ usernames: [username] });
      return;
    }
    const usernames = draft.usernames.includes(username) ? draft.usernames.filter((item) => item !== username) : [...draft.usernames, username];
    patch({ usernames: usernames.length ? usernames : "all" });
  }

  return (
    <div className={classNames("modal-backdrop")} role="presentation" onClick={onClose}>
      <section className={classNames("modal dredge-rule-modal")} role="dialog" aria-modal="true" aria-labelledby="dredge-rule-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 id="dredge-rule-modal-title">{draft.kind === "create" ? "新建打捞规则" : "编辑打捞规则"}</h2>
            <p>保存后才会更新规则；关闭弹窗会丢弃未保存改动。</p>
          </div>
          <button className={classNames("icon-button")} type="button" onClick={onClose} aria-label="关闭规则弹窗">
            ×
          </button>
        </div>
        <div className={classNames("dredge-rule-draft")}>
          <div className={classNames("dredge-rule-top")}>
            <strong>规则状态</strong>
            <label className="toggle compact-toggle">
              <input disabled={locked} type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />
              <span>{draft.enabled ? "启用" : "停用"}</span>
            </label>
          </div>
          <div className={classNames("dredge-rule-field")}>
            <span>规则类型</span>
            <div className={classNames("dredge-choice-row")}>
              <button className={classNames(draft.mode === "allow" && "active")} type="button" onClick={() => patch({ mode: "allow" })} disabled={locked}>
                允许
              </button>
              <button className={classNames(draft.mode === "block" && "active")} type="button" onClick={() => patch({ mode: "block" })} disabled={locked}>
                屏蔽
              </button>
            </div>
          </div>
          <label className={classNames("dredge-rule-field")}>
            <span>名称</span>
            <input  disabled={locked} value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
          </label>
          <div className={classNames("dredge-rule-field")}>
            <span>类型</span>
            <div className={classNames("dredge-choice-row")}>
              {ALL_ACTIVITY_KINDS.map((kind) => (
                <button className={classNames(draft.kinds.includes(kind) && "active", draft.kinds.includes(kind) && `kind-${kind}`)} key={kind} type="button" onClick={() => toggleKind(kind)} disabled={locked}>
                  {kindText(kind)}
                </button>
              ))}
            </div>
          </div>
          <div className={classNames("dredge-rule-field")}>
            <span>用户</span>
            <div className={classNames("dredge-choice-row dredge-user-choice-row")}>
              <button className={classNames(draft.usernames === "all" && "active")} type="button" onClick={() => patch({ usernames: "all" })} disabled={locked}>
                全部
              </button>
              {users.map((identity) => (
                <button
                  className={classNames(selectedUsers.includes(identity.username) && "active")}
                  key={identity.username}
                  type="button"
                  onClick={() => toggleUsername(identity.username)}
                  title={identity.secondary}
                  disabled={locked}
                >
                  {identity.primary}
                </button>
              ))}
            </div>
          </div>
          <label className={classNames("dredge-rule-field")}>
            <span>正则</span>
            <textarea

              disabled={locked}
              value={draft.patternText}
              onChange={(event) => patch({ patternText: event.target.value })}
              placeholder="一行一条正则；空白表示打捞所选范围内全部内容"
              rows={3}
            />
          </label>
          {warning ? <p className={classNames("dredge-rule-warning")}>{warning}</p> : null}
          {message ? <p className={classNames("dredge-rule-warning")} role="alert">{message}</p> : null}
          <div className={classNames("dredge-rule-draft-actions")}>
            <button className={classNames("primary-action")} type="button" onClick={onSave} disabled={locked}>
              保存
            </button>
            <button className={classNames("small-action")} type="button" onClick={onCancel}>
              取消
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function draftFromRule(rule: DredgeRule): DredgeRuleDraft {
  return {
    kind: "edit",
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    mode: rule.mode,
    usernames: rule.usernames,
    kinds: rule.kinds,
    patternText: rule.patterns.join("\n")
  };
}

function patternsFromText(text: string): string[] {
  const seen = new Set<string>();
  const patterns: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const pattern = line.trim();
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);
    patterns.push(pattern);
  }
  return patterns;
}

function summarizeUsers(usernames: DredgeRule["usernames"]): string {
  if (usernames === "all") return "全部用户";
  if (usernames.length <= 2) return usernames.map((username) => `@${username}`).join("、");
  return `${usernames.length} 位用户`;
}

function summarizeKinds(kinds: ActivityRefreshKind[]): string {
  if (kinds.length === ALL_ACTIVITY_KINDS.length) return "全部类型";
  return kinds.map(kindText).join("、");
}

function summarizePatterns(patterns: string[]): string {
  if (patterns.length === 0) return "全部内容";
  const preview = patterns[0].length > 18 ? `${patterns[0].slice(0, 18)}…` : patterns[0];
  return patterns.length === 1 ? `1 条正则：${preview}` : `${patterns.length} 条正则：${preview}`;
}
