import fs from 'node:fs/promises';
import { AiParseResponseSchema } from '../../server/generated/search-api.schemas.mjs';
import { AiParseCore } from '../../server/gateway-core/index.mjs';
import { getGatewayCore } from './gateway.js';

const promptUrl = new URL('../../server/prompts/food-request-parser.v1.md', import.meta.url);
const aiCore = globalThis.__KH_SHARED_AI_PARSE_CORE__ ?? new AiParseCore({
  coordinator: getGatewayCore().coordinator,
  responseSchema: AiParseResponseSchema,
  promptProvider: () => fs.readFile(promptUrl, 'utf8')
});
globalThis.__KH_SHARED_AI_PARSE_CORE__ = aiCore;

export function aiParseConfigured() {
  return aiCore.configured;
}

export function parseFoodRequest(input, options) {
  return aiCore.parse(input, options);
}
