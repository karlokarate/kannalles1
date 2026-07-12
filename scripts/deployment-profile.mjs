const FULL_APP = 'full-app';
const MANUAL_ONLY = 'manual-only';

export const DEPLOYMENT_PROFILES = Object.freeze([FULL_APP, MANUAL_ONLY]);

function validatedPublicGateway(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Das Full-App-Profil benötigt DATA_GATEWAY_URL.');
  if (raw.length > 2048 || Array.from(raw).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 32 || code === 127;
  })) {
    throw new Error('DATA_GATEWAY_URL enthält unzulässige Leer- oder Steuerzeichen.');
  }
  let url;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new Error('DATA_GATEWAY_URL ist keine gültige absolute URL.', { cause });
  }
  if (url.protocol !== 'https:') throw new Error('Das Full-App-Profil benötigt ein HTTPS-Gateway.');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('DATA_GATEWAY_URL darf keine Zugangsdaten, Query oder Fragment enthalten.');
  }
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) {
    throw new Error('Das Full-App-Profil darf kein Loopback-Gateway verwenden.');
  }
  return url.href.replace(/\/$/u, '');
}

export function validateDeploymentProfile(profileValue, gatewayValue = '') {
  const profile = String(profileValue ?? '').trim();
  if (!DEPLOYMENT_PROFILES.includes(profile)) {
    throw new Error(`Unbekanntes Deploymentprofil ${JSON.stringify(profile)}.`);
  }
  const configuredGateway = String(gatewayValue ?? '').trim();
  if (profile === MANUAL_ONLY) {
    if (configuredGateway) {
      throw new Error('Das Manual-only-Profil darf kein Daten-Gateway einbetten.');
    }
    return { profile, gatewayUrl: '' };
  }
  return { profile, gatewayUrl: validatedPublicGateway(configuredGateway) };
}
