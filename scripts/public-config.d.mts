export function validateAppVersion(value: unknown): string;
export function validateBuildId(value: unknown): string;
export function resolveBuildId(environment: Record<string, string | undefined>, appVersion: string): string;
export function buildIdAssetToken(value: unknown): string;
export function serviceWorkerMetadataFile(value: unknown): string;
