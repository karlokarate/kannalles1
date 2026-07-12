export const MIN_AI_SAFETY_SALT_LENGTH = 32;

export function isStrongAiSafetySalt(value) {
  return String(value || '').trim().length >= MIN_AI_SAFETY_SALT_LENGTH;
}

export function resolveAiConfiguration(env = process.env) {
  const apiKeyConfigured = Boolean(String(env.OPENAI_API_KEY || '').trim());
  const production = String(env.NODE_ENV || 'development').trim() === 'production';
  const allowSingleInstanceCoordination = String(env.ALLOW_SINGLE_INSTANCE_COORDINATION || '').trim() === '1';
  const distributedCoordinationRequired = String(env.REQUIRE_DISTRIBUTED_COORDINATION || '').trim() === '1'
    || (production && !allowSingleInstanceCoordination);
  const redisConfigured = Boolean(String(env.REDIS_COORDINATION_URL ?? env.REDIS_URL ?? '').trim());
  const safetySaltStrong = isStrongAiSafetySalt(env.AI_SAFETY_SALT);
  const safetyConfigurationRequired = apiKeyConfigured && production && !safetySaltStrong;
  const distributedCoordinationMissing = apiKeyConfigured
    && distributedCoordinationRequired
    && !redisConfigured;
  return {
    apiKeyConfigured,
    production,
    safetySaltStrong,
    redisConfigured,
    distributedCoordinationRequired,
    configured: apiKeyConfigured && !safetyConfigurationRequired && !distributedCoordinationMissing,
    reasonCode: !apiKeyConfigured
      ? 'OPENAI_API_KEY_MISSING'
      : safetyConfigurationRequired
        ? 'AI_SAFETY_SALT_MISSING_OR_WEAK'
        : distributedCoordinationMissing
          ? 'DISTRIBUTED_COORDINATION_REQUIRED'
        : null
  };
}
