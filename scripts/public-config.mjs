export function validateAppVersion(value) {
  const version = String(value || '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json version is not a safe semantic version: ${version}`);
  }
  return version;
}

export function validatePublicGatewayUrl(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  if ([...input].some((character) => (character.codePointAt(0) ?? 0) <= 0x20)) {
    throw new Error('VITE_DATA_GATEWAY_URL contains whitespace/control characters.');
  }
  if (input.startsWith('//')) throw new Error('Protocol-relative gateway URLs are forbidden.');
  const explicitScheme = /^[a-z][a-z\d+.-]*:/i.test(input);
  let url;
  try {
    url = new URL(input, explicitScheme ? undefined : 'https://kh-build.invalid/');
  } catch (cause) {
    throw new Error('VITE_DATA_GATEWAY_URL is malformed.', { cause });
  }
  if (url.username || url.password) throw new Error('Gateway URL must not contain userinfo.');
  if (url.search || url.hash) throw new Error('Gateway URL must not contain query or fragment data.');
  if (explicitScheme) {
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new Error('Gateway URL must use HTTPS; HTTP is allowed only for loopback development.');
    }
    url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    return url.toString();
  }
  if (!input.startsWith('/') || url.origin !== 'https://kh-build.invalid') {
    throw new Error('Relative gateway URL must be a same-origin absolute path beginning with /.');
  }
  return `${url.pathname}`;
}

export function javascriptJsonLiteral(value) {
  return JSON.stringify(String(value))
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}
