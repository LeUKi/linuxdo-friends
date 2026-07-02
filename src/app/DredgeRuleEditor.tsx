import React, { useMemo } from "react";
import { Telescope } from "lucide-react";
import { ALL_ACTIVITY_KINDS } from "../domain/friends";
import type { ActivityRefreshKind, AppState, DredgeRule, Username } from "../shared/types";
import { deriveFeedUserOptions, deriveDredgeRuleScopeWarning } from "../popup/selectors";
import { kindIcon, kindText } from "./activityKinds";

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
  function createRule() {
    onUpsertRule({
      name: "新打捞规则",
      enabled: true,
      usernames: "all",
      kinds: ALL_ACTIVITY_KINDS,
      keywords: []
    });
  }

  return (
    <section className="dredge-rule-panel">
      <div className="finds-section-head">
        <div>
          <h2 className="finds-title-with-icon">
            <Telescope size={16} aria-hidden="true" />
            <span>打捞规则</span>
          </h2>
        </div>
        <button className="small-action" type="button" onClick={createRule} disabled={locked}>
          新建
        </button>
      </div>
      {locked && lockReason ? <p className="dredge-rule-lock">{lockReason}</p> : null}
      {rules.length === 0 ? (
        <p className="empty finds-empty">当前没有规则，佬有料会保持为空。</p>
      ) : (
        <div className="dredge-rule-list">
          {rules.map((rule) => (
            <DredgeRuleCard
              key={rule.id}
              locked={locked}
              rule={rule}
              state={state}
              onRemoveRule={onRemoveRule}
              onUpsertRule={onUpsertRule}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DredgeRuleCard({
  locked,
  onRemoveRule,
  onUpsertRule,
  rule,
  state
}: {
  locked: boolean;
  onRemoveRule: (id: string) => void;
  onUpsertRule: (rule: Partial<DredgeRule> & { id?: string }) => void;
  rule: DredgeRule;
  state: AppState;
}) {
  const users = useMemo(() => deriveFeedUserOptions(state), [state]);
  const keywordText = rule.keywords.join(" ");
  const warning = deriveDredgeRuleScopeWarning(state, rule);
  const selectedUsers = rule.usernames === "all" ? [] : rule.usernames;

  function patch(next: Partial<DredgeRule>) {
    if (locked) return;
    onUpsertRule({ ...rule, ...next });
  }

  function toggleKind(kind: ActivityRefreshKind) {
    const kinds = rule.kinds.includes(kind) ? rule.kinds.filter((item) => item !== kind) : ALL_ACTIVITY_KINDS.filter((item) => item === kind || rule.kinds.includes(item));
    patch({ kinds });
  }

  function toggleUsername(username: Username) {
    if (rule.usernames === "all") {
      patch({ usernames: [username] });
      return;
    }
    const usernames = rule.usernames.includes(username) ? rule.usernames.filter((item) => item !== username) : [...rule.usernames, username];
    patch({ usernames: usernames.length ? usernames : "all" });
  }

  return (
    <article className="dredge-rule-card">
      <div className="dredge-rule-top">
        <label className="toggle compact-toggle">
          <input disabled={locked} type="checkbox" checked={rule.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />
          <span>{rule.enabled ? "启用" : "停用"}</span>
        </label>
        <button className="danger-action" type="button" onClick={() => onRemoveRule(rule.id)} disabled={locked}>
          删除
        </button>
      </div>
      <label className="dredge-rule-field">
        <span>名称</span>
        <input disabled={locked} value={rule.name} onChange={(event) => patch({ name: event.target.value })} />
      </label>
      <div className="dredge-rule-field">
        <span>类型</span>
        <div className="dredge-choice-row">
          {ALL_ACTIVITY_KINDS.map((kind) => (
            <button className={rule.kinds.includes(kind) ? `active kind-${kind}` : ""} key={kind} type="button" onClick={() => toggleKind(kind)} disabled={locked}>
              {kindIcon(kind, 13)}
              {kindText(kind)}
            </button>
          ))}
        </div>
      </div>
      <div className="dredge-rule-field">
        <span>用户</span>
        <div className="dredge-choice-row dredge-user-choice-row">
          <button className={rule.usernames === "all" ? "active" : ""} type="button" onClick={() => patch({ usernames: "all" })} disabled={locked}>
            全部
          </button>
          {users.map((identity) => (
            <button
              className={selectedUsers.includes(identity.username) ? "active" : ""}
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
      <label className="dredge-rule-field">
        <span>关键词</span>
        <input
          disabled={locked}
          value={keywordText}
          onChange={(event) => patch({ keywords: event.target.value.split(/[\s,，]+/).filter(Boolean) })}
          placeholder="空白表示打捞所选范围内全部动态"
        />
      </label>
      {warning ? <p className="dredge-rule-warning">{warning}</p> : null}
    </article>
  );
}
