export function validateAppVersion(value) {
  const version = String(value || '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json version is not a safe semantic version: ${version}`);
  }
  return version;
}
