import { AiParseResponseSchema } from '../generated/search-api';
import type { ParsedFoodRequest } from '../types';
import { parseFoodRequestLocal } from './parser';

export async function parseFoodRequestWithAi(
  rawInput: string,
  endpoint: string,
  signal?: AbortSignal
): Promise<ParsedFoodRequest> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: rawInput }),
    signal
  });

  if (!response.ok) {
    throw new Error(`OpenAI-Parser nicht verfügbar (${response.status}).`);
  }

  const parsed = AiParseResponseSchema.parse(await response.json());
  const localEvidence = parseFoodRequestLocal(rawInput);
  return {
    ...parsed,
    amount: {
      ...parsed.amount,
      valueExplicit: localEvidence.amount.valueExplicit,
      unitExplicit: localEvidence.amount.unitExplicit
    }
  };
}
