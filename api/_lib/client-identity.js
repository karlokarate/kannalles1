import { createHmac } from 'node:crypto';

export const MIN_GATEWAY_CLIENT_SALT_LENGTH = 32;

export function hasStrongGatewayClientSalt(env = process.env) {
  return String(env.GATEWAY_CLIENT_SALT || '').trim().length >= MIN_GATEWAY_CLIENT_SALT_LENGTH;
}

export function clientBudgetIdentifierForRequest(req, env = process.env) {
  const salt = String(env.GATEWAY_CLIENT_SALT || '').trim();
  if (salt.length < MIN_GATEWAY_CLIENT_SALT_LENGTH) return undefined;
  const trustedExpressAddress = String(req?.ip || '').trim();
  const address = trustedExpressAddress
    || String(req?.socket?.remoteAddress || '').trim();
  if (!address) return undefined;
  return `kh_client_${createHmac('sha256', salt)
    .update(address.toLocaleLowerCase('en-US'))
    .digest('hex')
    .slice(0, 32)}`;
}
