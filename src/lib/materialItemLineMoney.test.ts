import { describe, it, expect } from 'vitest';
import {
  getMaterialLineSellAndCost,
  parseLengthToFeet,
  zohoRateFromLineTotal,
} from './materialItemLineMoney';

describe('parseLengthToFeet', () => {
  it('returns null for empty / missing length', () => {
    expect(parseLengthToFeet(null)).toBeNull();
    expect(parseLengthToFeet(undefined)).toBeNull();
    expect(parseLengthToFeet('')).toBeNull();
    expect(parseLengthToFeet('   ')).toBeNull();
  });

  it('parses plain decimal feet', () => {
    expect(parseLengthToFeet('10')).toBe(10);
    expect(parseLengthToFeet('10.5')).toBe(10.5);
  });

  it('parses feet-and-inches notation', () => {
    expect(parseLengthToFeet("10'")).toBe(10);
    expect(parseLengthToFeet("10' 6")).toBe(10.5);
    expect(parseLengthToFeet("10' 6\"")).toBe(10.5);
    expect(parseLengthToFeet("3' 3")).toBeCloseTo(3.25, 10);
  });

  it('returns null for non-numeric junk', () => {
    expect(parseLengthToFeet('abc')).toBeNull();
  });
});

describe('getMaterialLineSellAndCost — non-metal', () => {
  it('multiplies per-unit cost/price by quantity', () => {
    const r = getMaterialLineSellAndCost({
      category: 'Lumber',
      quantity: 4,
      cost_per_unit: 2.5,
      price_per_unit: 4,
    });
    expect(r.cost).toBe(10);
    expect(r.price).toBe(16);
  });

  it('defaults quantity to 1 when missing or zero', () => {
    const r = getMaterialLineSellAndCost({
      category: 'Lumber',
      quantity: 0,
      cost_per_unit: 7,
      price_per_unit: 9,
    });
    expect(r.cost).toBe(7);
    expect(r.price).toBe(9);
  });

  it('falls back to stored extended_* when no per-unit values', () => {
    const r = getMaterialLineSellAndCost({
      category: 'Lumber',
      quantity: 3,
      cost_per_unit: null,
      price_per_unit: null,
      extended_cost: 33,
      extended_price: 55,
    });
    // extended_* is already a line total, so quantity must NOT be re-applied.
    expect(r.cost).toBe(33);
    expect(r.price).toBe(55);
  });

  it('treats a length on a non-metal item as irrelevant to price (unit × qty wins)', () => {
    const r = getMaterialLineSellAndCost({
      category: 'Trim',
      quantity: 2,
      length: "10'",
      cost_per_unit: 5,
      price_per_unit: 8,
    });
    expect(r.cost).toBe(10);
    expect(r.price).toBe(16);
  });
});

describe('getMaterialLineSellAndCost — metal lineal-foot pricing', () => {
  it('uses $/ft × length × qty when per-unit values are present', () => {
    const r = getMaterialLineSellAndCost({
      category: 'Metal',
      quantity: 3,
      length: "10'",
      cost_per_unit: 2, // $/ft
      price_per_unit: 3, // $/ft
    });
    // 2 $/ft × 10 ft × 3 pcs = 60 ; 3 $/ft × 10 ft × 3 pcs = 90
    expect(r.cost).toBe(60);
    expect(r.price).toBe(90);
  });

  it('uses the metal catalog $/ft when the item has no per-unit override', () => {
    const r = getMaterialLineSellAndCost(
      {
        category: 'Metal',
        quantity: 2,
        length: "10'",
        sku: 'MTL-1',
        cost_per_unit: null,
        price_per_unit: null,
      },
      { 'MTL-1': { purchase_cost: 1.5, unit_price: 2.5 } },
    );
    // catalog: 1.5 $/ft × 10 × 2 = 30 ; 2.5 $/ft × 10 × 2 = 50
    expect(r.cost).toBe(30);
    expect(r.price).toBe(50);
  });

  it('falls back to stored extended_* for metal with no length', () => {
    const r = getMaterialLineSellAndCost({
      category: 'Metal',
      quantity: 5,
      length: null,
      cost_per_unit: null,
      price_per_unit: null,
      extended_cost: 12,
      extended_price: 20,
    });
    expect(r.cost).toBe(12);
    expect(r.price).toBe(20);
  });
});

describe('zohoRateFromLineTotal', () => {
  it('derives the per-unit rate from a line total and billed quantity', () => {
    expect(zohoRateFromLineTotal(100, 4)).toBe(25);
  });

  it('returns the line total unchanged when quantity is invalid', () => {
    expect(zohoRateFromLineTotal(100, 0)).toBe(100);
    expect(zohoRateFromLineTotal(100, -1)).toBe(100);
    expect(zohoRateFromLineTotal(100, NaN)).toBe(100);
  });
});
