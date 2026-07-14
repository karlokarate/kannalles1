export type DiabetesFactorKey = 'carbohydrateRatioG' | 'correctionFactorMgDl' | 'targetGlucoseMgDl';

export interface DiabetesFactorSegment {
  id: string;
  startMinute: number;
  endMinute: number;
  value: number | null;
}

export type DiabetesFactorSegments = Record<DiabetesFactorKey, DiabetesFactorSegment[]>;

/** Legacy shape used before each factor received its own time plan. */
export interface DiabetesTimeSegment {
  id: string;
  startMinute: number;
  endMinute: number;
  carbohydrateRatioG: number | null;
  correctionFactorMgDl: number | null;
  targetGlucoseMgDl: number | null;
}

export interface ActiveDiabetesFactors {
  carbohydrateRatioG: number | null;
  correctionFactorMgDl: number | null;
  targetGlucoseMgDl: number | null;
}

export interface BolusCalculation {
  carbohydrateBolus: number | null;
  correctionBolus: number | null;
  totalBolus: number | null;
}

interface SegmentWindow {
  id: string;
  startMinute: number;
  endMinute: number;
}

const DEFAULT_BOUNDARIES = [0, 360, 540, 660, 840, 1020, 1260, 1440] as const;
const FACTOR_LIMITS: Record<DiabetesFactorKey, { min: number; max: number }> = {
  carbohydrateRatioG: { min: 1, max: 150 },
  correctionFactorMgDl: { min: 1, max: 400 },
  targetGlucoseMgDl: { min: 40, max: 300 }
};
const FACTOR_KEYS = Object.keys(FACTOR_LIMITS) as DiabetesFactorKey[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validOptionalNumber(value: unknown, min: number, max: number): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
}

export function defaultDiabetesFactorSegments(key: DiabetesFactorKey): DiabetesFactorSegment[] {
  return DEFAULT_BOUNDARIES.slice(0, -1).map((startMinute, index) => ({
    id: `${key}-segment-${index + 1}`,
    startMinute,
    endMinute: DEFAULT_BOUNDARIES[index + 1],
    value: null
  }));
}

export function defaultDiabetesFactorSchedules(): DiabetesFactorSegments {
  return {
    carbohydrateRatioG: defaultDiabetesFactorSegments('carbohydrateRatioG'),
    correctionFactorMgDl: defaultDiabetesFactorSegments('correctionFactorMgDl'),
    targetGlucoseMgDl: defaultDiabetesFactorSegments('targetGlucoseMgDl')
  };
}

export function defaultDiabetesSegments(): DiabetesTimeSegment[] {
  return DEFAULT_BOUNDARIES.slice(0, -1).map((startMinute, index) => ({
    id: `segment-${index + 1}`,
    startMinute,
    endMinute: DEFAULT_BOUNDARIES[index + 1],
    carbohydrateRatioG: null,
    correctionFactorMgDl: null,
    targetGlucoseMgDl: null
  }));
}

export function normalizeDiabetesSegments(value: unknown): DiabetesTimeSegment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return defaultDiabetesSegments();
  const segments: DiabetesTimeSegment[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!isRecord(candidate)) return defaultDiabetesSegments();
    const startMinute = candidate.startMinute;
    const endMinute = candidate.endMinute;
    if (typeof startMinute !== 'number' || typeof endMinute !== 'number'
      || !Number.isInteger(startMinute) || !Number.isInteger(endMinute)
      || startMinute < 0 || endMinute > 1440 || startMinute >= endMinute
      || (index === 0 ? startMinute !== 0 : startMinute !== segments[index - 1].endMinute)
      || !validOptionalNumber(candidate.carbohydrateRatioG, 1, 150)
      || !validOptionalNumber(candidate.correctionFactorMgDl, 1, 400)
      || !validOptionalNumber(candidate.targetGlucoseMgDl, 40, 300)) return defaultDiabetesSegments();
    segments.push({
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `segment-${index + 1}`,
      startMinute,
      endMinute,
      carbohydrateRatioG: candidate.carbohydrateRatioG,
      correctionFactorMgDl: candidate.correctionFactorMgDl,
      targetGlucoseMgDl: candidate.targetGlucoseMgDl
    });
  }
  return segments.at(-1)?.endMinute === 1440 ? segments : defaultDiabetesSegments();
}

function normalizeFactorSegmentList(value: unknown, key: DiabetesFactorKey): DiabetesFactorSegment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return defaultDiabetesFactorSegments(key);
  const { min, max } = FACTOR_LIMITS[key];
  const segments: DiabetesFactorSegment[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!isRecord(candidate)) return defaultDiabetesFactorSegments(key);
    const startMinute = candidate.startMinute;
    const endMinute = candidate.endMinute;
    if (typeof startMinute !== 'number' || typeof endMinute !== 'number'
      || !Number.isInteger(startMinute) || !Number.isInteger(endMinute)
      || startMinute < 0 || endMinute > 1440 || startMinute >= endMinute
      || (index === 0 ? startMinute !== 0 : startMinute !== segments[index - 1].endMinute)
      || !validOptionalNumber(candidate.value, min, max)) return defaultDiabetesFactorSegments(key);
    segments.push({
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `${key}-segment-${index + 1}`,
      startMinute,
      endMinute,
      value: candidate.value
    });
  }
  return segments.at(-1)?.endMinute === 1440 ? segments : defaultDiabetesFactorSegments(key);
}

export function migrateLegacyDiabetesSegments(value: unknown): DiabetesFactorSegments {
  const legacy = normalizeDiabetesSegments(value);
  return {
    carbohydrateRatioG: legacy.map((segment, index) => ({ id: `carbohydrateRatioG-segment-${index + 1}`, startMinute: segment.startMinute, endMinute: segment.endMinute, value: segment.carbohydrateRatioG })),
    correctionFactorMgDl: legacy.map((segment, index) => ({ id: `correctionFactorMgDl-segment-${index + 1}`, startMinute: segment.startMinute, endMinute: segment.endMinute, value: segment.correctionFactorMgDl })),
    targetGlucoseMgDl: legacy.map((segment, index) => ({ id: `targetGlucoseMgDl-segment-${index + 1}`, startMinute: segment.startMinute, endMinute: segment.endMinute, value: segment.targetGlucoseMgDl }))
  };
}

export function normalizeDiabetesFactorSchedules(value: unknown, legacyValue?: unknown): DiabetesFactorSegments {
  if (!isRecord(value) || !FACTOR_KEYS.some((key) => Object.hasOwn(value, key))) {
    return legacyValue === undefined ? defaultDiabetesFactorSchedules() : migrateLegacyDiabetesSegments(legacyValue);
  }
  return {
    carbohydrateRatioG: normalizeFactorSegmentList(value.carbohydrateRatioG, 'carbohydrateRatioG'),
    correctionFactorMgDl: normalizeFactorSegmentList(value.correctionFactorMgDl, 'correctionFactorMgDl'),
    targetGlucoseMgDl: normalizeFactorSegmentList(value.targetGlucoseMgDl, 'targetGlucoseMgDl')
  };
}

export function minuteToTimeInput(minute: number): string {
  if (minute === 1440) return '24:00';
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function timeInputToMinute(value: string): number | null {
  if (value === '24:00') return 1440;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
}

export function changeSegmentBoundary<T extends SegmentWindow>(segments: readonly T[], boundaryIndex: number, minute: number): T[] {
  if (boundaryIndex < 1 || boundaryIndex >= segments.length || !Number.isInteger(minute)) return [...segments];
  const previousBoundary = segments[boundaryIndex - 1].startMinute;
  const nextBoundary = segments[boundaryIndex].endMinute;
  if (minute <= previousBoundary || minute >= nextBoundary) return [...segments];
  return segments.map((segment, index) => index === boundaryIndex - 1
    ? { ...segment, endMinute: minute }
    : index === boundaryIndex
      ? { ...segment, startMinute: minute }
      : segment);
}

export function addDiabetesSegment<T extends SegmentWindow>(segments: readonly T[]): T[] {
  if (segments.length >= 12) return [...segments];
  const index = segments.reduce((best, segment, current) => segment.endMinute - segment.startMinute > segments[best].endMinute - segments[best].startMinute ? current : best, 0);
  const source = segments[index];
  const midpoint = Math.round(((source.startMinute + source.endMinute) / 2) / 15) * 15;
  if (midpoint <= source.startMinute || midpoint >= source.endMinute) return [...segments];
  const nextId = `segment-${Date.now()}-${segments.length + 1}`;
  return segments.flatMap((segment, current) => current === index ? [
    { ...segment, endMinute: midpoint },
    { ...segment, id: nextId, startMinute: midpoint }
  ] : [segment]);
}

export function removeDiabetesSegment<T extends SegmentWindow>(segments: readonly T[], index: number): T[] {
  if (segments.length <= 1 || index < 0 || index >= segments.length) return [...segments];
  if (index === 0) return [{ ...segments[1], startMinute: 0 }, ...segments.slice(2)];
  return segments.filter((_, current) => current !== index).map((segment, current) => current === index - 1 ? { ...segment, endMinute: segments[index].endMinute } : segment);
}

export function activeDiabetesSegment<T extends SegmentWindow>(segments: readonly T[], date = new Date()): T {
  const minute = date.getHours() * 60 + date.getMinutes();
  return segments.find((segment) => minute >= segment.startMinute && minute < segment.endMinute) ?? segments[0];
}

export function activeDiabetesFactors(schedules: DiabetesFactorSegments, date = new Date()): ActiveDiabetesFactors {
  return {
    carbohydrateRatioG: activeDiabetesSegment(schedules.carbohydrateRatioG, date).value,
    correctionFactorMgDl: activeDiabetesSegment(schedules.correctionFactorMgDl, date).value,
    targetGlucoseMgDl: activeDiabetesSegment(schedules.targetGlucoseMgDl, date).value
  };
}

export function calculateBolus(carbohydratesG: number | null, currentGlucoseMgDl: number | null, factors: ActiveDiabetesFactors): BolusCalculation {
  const carbohydrateBolus = carbohydratesG !== null && carbohydratesG >= 0 && factors.carbohydrateRatioG !== null
    ? carbohydratesG / factors.carbohydrateRatioG
    : null;
  const correctionBolus = currentGlucoseMgDl !== null && factors.correctionFactorMgDl !== null && factors.targetGlucoseMgDl !== null
    ? (currentGlucoseMgDl - factors.targetGlucoseMgDl) / factors.correctionFactorMgDl
    : null;
  const totalBolus = carbohydrateBolus === null
    ? correctionBolus === null ? null : Math.max(0, correctionBolus)
    : Math.max(0, carbohydrateBolus + (correctionBolus ?? 0));
  return { carbohydrateBolus, correctionBolus, totalBolus };
}
