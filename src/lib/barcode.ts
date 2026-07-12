/** Canonical barcode form used by Open Food Facts identity and cache keys. */
export function normalizeOffBarcode(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits || digits.length > 14) return null;
  const significant = digits.replace(/^0+/, '') || '0';
  if (significant.length <= 7) return significant.padStart(8, '0');
  if (significant.length === 8) return significant;
  if (significant.length <= 12) return significant.padStart(13, '0');
  if (significant.length <= 14) return significant;
  return null;
}

export function isOffBarcodeInput(value: string | null | undefined): boolean {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 14;
}

export interface OffBarcodeEvidence {
  /** Canonical OFF identity (7→8 and 9–12→13 digits). */
  normalized: string;
  /** Exact substring from the user's input, including accepted separators. */
  raw: string;
  start: number;
  end: number;
}

const BARCODE_SEQUENCE = /(?:^|[^\d])((?:\d[\s.\-_/()]*){6,13}\d)(?![\s.\-_/()]*\d)/g;

/**
 * Finds explicit 7–14 digit barcode evidence without mistaking ordinary
 * numeric product names such as “7 Days” for a barcode. Spaces and common
 * scanner/label separators are accepted, but letters may not split digits.
 */
export function extractOffBarcodeEvidence(input: string): OffBarcodeEvidence | null {
  for (const match of input.matchAll(BARCODE_SEQUENCE)) {
    const raw = match[1];
    if (!raw) continue;
    const normalized = normalizeOffBarcode(raw);
    if (!normalized) continue;
    const full = match[0];
    const offset = full.lastIndexOf(raw);
    const start = (match.index ?? 0) + Math.max(0, offset);
    return { normalized, raw, start, end: start + raw.length };
  }
  return null;
}

export function evidencedOffBarcodes(input: string): Set<string> {
  const result = new Set<string>();
  let offset = 0;
  while (offset < input.length) {
    const evidence = extractOffBarcodeEvidence(input.slice(offset));
    if (!evidence) break;
    result.add(evidence.normalized);
    offset += Math.max(evidence.end, 1);
  }
  return result;
}
