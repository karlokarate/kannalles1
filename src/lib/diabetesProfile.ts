export interface DiabetesTimeSegment {
  id: string;
  startMinute: number;
  endMinute: number;
  carbohydrateRatioG: number | null;
  correctionFactorMgDl: number | null;
  targetGlucoseMgDl: number | null;
}

export interface BolusCalculation {
  carbohydrateBolus: number | null;
  correctionBolus: number | null;
  totalBolus: number | null;
}

const DEFAULT_BOUNDARIES = [0, 360, 540, 660, 840, 1020, 1260, 1440] as const;

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

function validOptionalNumber(value: unknown, min: number, max: number): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
}

export function normalizeDiabetesSegments(value: unknown): DiabetesTimeSegment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return defaultDiabetesSegments();
  const segments: DiabetesTimeSegment[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!candidate || typeof candidate !== 'object') return defaultDiabetesSegments();
    const item = candidate as Partial<DiabetesTimeSegment>;
    const startMinute = item.startMinute;
    const endMinute = item.endMinute;
    if (typeof startMinute !== 'number' || typeof endMinute !== 'number'
      || !Number.isInteger(startMinute) || !Number.isInteger(endMinute)
      || startMinute < 0 || endMinute > 1440 || startMinute >= endMinute
      || (index === 0 ? startMinute !== 0 : startMinute !== segments[index - 1].endMinute)
      || !validOptionalNumber(item.carbohydrateRatioG, 1, 150)
      || !validOptionalNumber(item.correctionFactorMgDl, 1, 400)
      || !validOptionalNumber(item.targetGlucoseMgDl, 40, 300)) return defaultDiabetesSegments();
    segments.push({
      id: typeof item.id === 'string' && item.id ? item.id : `segment-${index + 1}`,
      startMinute,
      endMinute,
      carbohydrateRatioG: item.carbohydrateRatioG,
      correctionFactorMgDl: item.correctionFactorMgDl,
      targetGlucoseMgDl: item.targetGlucoseMgDl
    });
  }
  return segments.at(-1)?.endMinute === 1440 ? segments : defaultDiabetesSegments();
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

export function changeSegmentBoundary(segments: readonly DiabetesTimeSegment[], boundaryIndex: number, minute: number): DiabetesTimeSegment[] {
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

export function addDiabetesSegment(segments: readonly DiabetesTimeSegment[]): DiabetesTimeSegment[] {
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

export function removeDiabetesSegment(segments: readonly DiabetesTimeSegment[], index: number): DiabetesTimeSegment[] {
  if (segments.length <= 1 || index < 0 || index >= segments.length) return [...segments];
  if (index === 0) return [{ ...segments[1], startMinute: 0 }, ...segments.slice(2)];
  return segments.filter((_, current) => current !== index).map((segment, current) => current === index - 1 ? { ...segment, endMinute: segments[index].endMinute } : segment);
}

export function activeDiabetesSegment(segments: readonly DiabetesTimeSegment[], date = new Date()): DiabetesTimeSegment {
  const minute = date.getHours() * 60 + date.getMinutes();
  return segments.find((segment) => minute >= segment.startMinute && minute < segment.endMinute) ?? segments[0];
}

export function calculateBolus(carbohydratesG: number | null, currentGlucoseMgDl: number | null, segment: DiabetesTimeSegment): BolusCalculation {
  const carbohydrateBolus = carbohydratesG !== null && carbohydratesG >= 0 && segment.carbohydrateRatioG !== null
    ? carbohydratesG / segment.carbohydrateRatioG
    : null;
  const correctionBolus = currentGlucoseMgDl !== null && segment.correctionFactorMgDl !== null && segment.targetGlucoseMgDl !== null
    ? (currentGlucoseMgDl - segment.targetGlucoseMgDl) / segment.correctionFactorMgDl
    : null;
  const totalBolus = carbohydrateBolus === null
    ? correctionBolus === null ? null : Math.max(0, correctionBolus)
    : Math.max(0, carbohydrateBolus + (correctionBolus ?? 0));
  return { carbohydrateBolus, correctionBolus, totalBolus };
}
