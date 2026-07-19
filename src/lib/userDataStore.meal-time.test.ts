import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listMealCalculations,
  saveMealCalculation,
  type SavedMealCalculation
} from './userDataStore';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function meal(id = 'meal-1'): SavedMealCalculation {
  return {
    schemaVersion: 1,
    id,
    createdAt: '2000-01-01T00:00:00.000Z',
    items: [{
      id: 'line-1',
      productCode: '4008400322728',
      productName: 'Kinder Bueno',
      amount: 2,
      unit: 'bar',
      selectedOptionId: 'bar:test',
      unitBaseValue: 21.5,
      carbohydratesG: 21.285
    }],
    totalCarbohydratesG: 21.285
  };
}

beforeEach(() => {
  const localStorage = new MemoryStorage();
  vi.stubGlobal('window', {
    localStorage,
    dispatchEvent: vi.fn()
  });
  if (typeof CustomEvent === 'undefined') {
    vi.stubGlobal('CustomEvent', class<T> extends Event {
      readonly detail: T | undefined;
      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail;
      }
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('automatic saved meal execution time', () => {
  it('replaces stale caller timestamps with the exact performed time', () => {
    saveMealCalculation(meal(), '2026-07-19T10:45:12.345+02:00');

    expect(listMealCalculations()).toEqual([
      expect.objectContaining({
        id: 'meal-1',
        createdAt: '2026-07-19T08:45:12.345Z'
      })
    ]);
  });

  it('updates the performed time whenever the same automatic calculation is recalculated', () => {
    saveMealCalculation(meal(), '2026-07-19T08:00:00.000Z');
    saveMealCalculation({ ...meal(), totalCarbohydratesG: 25 }, '2026-07-19T08:05:30.250Z');

    const stored = listMealCalculations();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: 'meal-1',
      createdAt: '2026-07-19T08:05:30.250Z',
      totalCarbohydratesG: 25
    });
  });

  it('rejects date-only or invalid values so a time is always present', () => {
    saveMealCalculation(meal('date-only'), '2026-07-19');
    saveMealCalculation(meal('invalid'), 'not-a-time');

    expect(listMealCalculations()).toEqual([]);
  });
});
