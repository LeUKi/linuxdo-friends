export type OptionsSectionId = "basic" | "scope" | "lao-finds" | "request-stats" | "notifications" | "data" | "sponsor";

export const OPTIONS_SECTIONS: Array<{ id: OptionsSectionId; hash: string; label: string }> = [
  { id: "basic", hash: "#basic", label: "基础" },
  { id: "scope", hash: "#scope", label: "视奸范围" },
  { id: "lao-finds", hash: "#lao-finds", label: "佬料打捞" },
  { id: "notifications", hash: "#notifications", label: "新料通知" },
  { id: "request-stats", hash: "#request-stats", label: "请求统计" },
  { id: "data", hash: "#data", label: "数据管理" },
  { id: "sponsor", hash: "#sponsor", label: "赞助" }
];

const SECTION_BY_HASH = new Map(OPTIONS_SECTIONS.map((section) => [section.hash, section.id]));
const HASH_ALIASES = new Map<string, { hash: string; preserve?: boolean }>([
  ["#friends", { hash: "#scope" }],
  ["#sync", { hash: "#data" }],
  ["#maintenance", { hash: "#data" }],
  ["#cloud-backup", { hash: "#data", preserve: true }]
]);

export function sectionFromHash(hash: string): OptionsSectionId {
  const canonicalHash = canonicalizeOptionsHash(hash);
  return SECTION_BY_HASH.get(canonicalHash === "#cloud-backup" ? "#data" : canonicalHash) ?? "basic";
}

export function canonicalizeOptionsHash(hash: string) {
  const alias = HASH_ALIASES.get(hash);
  if (alias?.preserve) return hash;
  if (alias) return alias.hash;
  if (SECTION_BY_HASH.has(hash)) return hash;
  return "#basic";
}
