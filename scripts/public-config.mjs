export function validateAppVersion(value) {
  const version = String(value || '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json version is not a safe semantic version: ${version}`);
  }
  return version;
}

export function validateBuildId(value) {
  const buildId = String(value || '').trim();
  if (!/^[0-9A-Za-z._:-]{1,128}$/.test(buildId)) {
    throw new Error(`Build identity is not safe: ${JSON.stringify(buildId)}`);
  }
  return buildId;
}

export function resolveBuildId(environment, appVersion) {
  return validateBuildId(
    environment.KH_BUILD_ID
      || environment.GITHUB_SHA
      || `version-${validateAppVersion(appVersion)}`
  );
}
