import { createGatewayClient } from '../generated/search-api';
import type { ParsedFoodRequest } from '../types';
import { evidencedOffBarcodes, normalizeOffBarcode } from './barcode';
import { parseFoodRequestLocal } from './parser';

export async function parseFoodRequestWithAi(
  rawInput: string,
  gatewayUrl: string,
  signal?: AbortSignal
): Promise<ParsedFoodRequest> {
  const client = createGatewayClient({
    baseUrl: gatewayUrl,
    defaultInit: { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }
  });
  const { data: parsed } = await client.parse({ input: rawInput }, { signal });
  const localEvidence = parseFoodRequestLocal(rawInput);
  if (localEvidence.status !== 'parsed') return { ...localEvidence, rawInput };
  const normalizedAiBarcode = normalizeOffBarcode(parsed.barcode);
  const barcodeEvidence = evidencedOffBarcodes(rawInput);
  if (parsed.barcode !== null && (!normalizedAiBarcode || !barcodeEvidence.has(normalizedAiBarcode))) {
    return { ...localEvidence, rawInput };
  }
  const evidencedBarcode = localEvidence.barcode ?? normalizedAiBarcode;
  return {
    ...parsed,
    rawInput,
    barcode: evidencedBarcode,
    resolutionMode: evidencedBarcode ? 'barcode' : parsed.resolutionMode,
    amount: {
      ...parsed.amount,
      value: localEvidence.amount.valueExplicit ? localEvidence.amount.value : parsed.amount.value,
      unit: localEvidence.amount.unitExplicit ? localEvidence.amount.unit : parsed.amount.unit,
      valueExplicit: localEvidence.amount.valueExplicit,
      unitExplicit: localEvidence.amount.unitExplicit
    }
  };
}
