import { normalizeDiabetesSegments, type DiabetesTimeSegment } from './diabetesProfile';
import type { OfflineAppSettings } from './settings';
import { exportHistoryData, type HistoryTransferData } from './userDataStore';

export interface KhCheckerTransferFile {
  format: 'fishit-kh-checker-transfer';
  schemaVersion: 1;
  exportedAt: string;
  diabetes: {
    enabled: boolean;
    segments: DiabetesTimeSegment[];
  };
  history: HistoryTransferData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createTransferFile(settings: OfflineAppSettings, exportedAt = new Date().toISOString(), history = exportHistoryData()): KhCheckerTransferFile {
  return {
    format: 'fishit-kh-checker-transfer',
    schemaVersion: 1,
    exportedAt,
    diabetes: { enabled: settings.diabeticProfileEnabled, segments: settings.diabetesSegments },
    history
  };
}

export function parseTransferFile(raw: string): KhCheckerTransferFile | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.format !== 'fishit-kh-checker-transfer' || value.schemaVersion !== 1 || typeof value.exportedAt !== 'string' || !isRecord(value.diabetes) || typeof value.diabetes.enabled !== 'boolean' || !isRecord(value.history) || !Array.isArray(value.history.calculations) || !Array.isArray(value.history.meals) || !Array.isArray(value.history.calibrations)) return null;
    return {
      format: 'fishit-kh-checker-transfer',
      schemaVersion: 1,
      exportedAt: value.exportedAt,
      diabetes: { enabled: value.diabetes.enabled, segments: normalizeDiabetesSegments(value.diabetes.segments) },
      history: { calculations: value.history.calculations as HistoryTransferData['calculations'], meals: value.history.meals as HistoryTransferData['meals'], calibrations: value.history.calibrations as HistoryTransferData['calibrations'] }
    };
  } catch {
    return null;
  }
}

export function serializeTransferFile(file: KhCheckerTransferFile): string {
  return JSON.stringify(file, null, 2);
}
