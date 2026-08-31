export type DataConsentFeature = "telegram" | "cloudSave" | "updateCheck";

export type DataCollectionPermission =
  | "authenticationInfo"
  | "personallyIdentifyingInfo"
  | "personalCommunications"
  | "websiteContent"
  | "technicalAndInteraction";

export const DATA_CONSENT_PERMISSIONS: Record<DataConsentFeature, readonly DataCollectionPermission[]> = {
  telegram: ["authenticationInfo", "personallyIdentifyingInfo", "personalCommunications", "websiteContent"],
  cloudSave: ["authenticationInfo", "personallyIdentifyingInfo", "websiteContent", "technicalAndInteraction"],
  updateCheck: ["technicalAndInteraction"]
};

export const DATA_CONSENT_REQUIRED_MESSAGE = "Firefox 数据权限未开启，已取消本次联网操作。";

interface DataCollectionPermissionsApi {
  getAll(): Promise<{ data_collection?: string[] }>;
  request(details: { data_collection: readonly DataCollectionPermission[] }): Promise<boolean>;
}

export function isFirefoxExtension(): boolean {
  if (typeof chrome === "undefined" || !chrome.runtime?.getManifest) return false;
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    browser_specific_settings?: { gecko?: { id?: string } };
  };
  return Boolean(manifest.browser_specific_settings?.gecko);
}

export async function hasDataConsent(feature: DataConsentFeature): Promise<boolean> {
  if (!isFirefoxExtension()) return true;
  const permissions = firefoxDataPermissionsApi();
  if (!permissions) return false;
  try {
    const granted = await permissions.getAll();
    return DATA_CONSENT_PERMISSIONS[feature].every((permission) => granted.data_collection?.includes(permission));
  } catch {
    return false;
  }
}

export async function requestDataConsent(feature: DataConsentFeature): Promise<boolean> {
  if (!isFirefoxExtension()) return true;
  const permissions = firefoxDataPermissionsApi();
  if (!permissions) return false;
  try {
    return await permissions.request({ data_collection: DATA_CONSENT_PERMISSIONS[feature] });
  } catch {
    return false;
  }
}

export async function requireDataConsent(feature: DataConsentFeature): Promise<void> {
  if (!(await hasDataConsent(feature))) throw new Error(DATA_CONSENT_REQUIRED_MESSAGE);
}

function firefoxDataPermissionsApi(): DataCollectionPermissionsApi | null {
  const browserApi = (globalThis as typeof globalThis & { browser?: { permissions?: DataCollectionPermissionsApi } }).browser;
  const chromeApi = chrome.permissions as unknown as DataCollectionPermissionsApi | undefined;
  return browserApi?.permissions ?? chromeApi ?? null;
}
