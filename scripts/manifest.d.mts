export type TargetBrowser = "chrome" | "firefox";

export const BROWSERS: TargetBrowser[];

export function getTargetBrowser(input?: string): TargetBrowser;

export function getTargetOutDir(browser?: TargetBrowser): "dist-chrome" | "dist-firefox";

export function createManifest(browser?: TargetBrowser): Record<string, unknown>;
