import { describe, it, expect } from 'vitest';
import {
  computeLineBreakdownTotals,
  isLaborBreakdownRow,
  type ProposalLineBreakdownRow,
} from './proposalLineBreakdownExport';

/** Build a line row with sensible defaults so tests only specify what they care about. */
function mkRow(partial: Partial<ProposalLineBreakdownRow>): ProposalLineBreakdownRow {
  return {
    section: 'Section',
    lineType: 'Material',
    category: 'Material',
    description: '',
    sku: '',
    quantity: 1,
    unit: 'pcs',
    unitCost: 0,
    baseAmount: 0,
    markupPct: 0,
    linePrice: 0,
    optional: false,
    notes: '',
    ...partial,
  };
}

describe('isLaborBreakdownRow', () => {
  it('classifies section labor, subcontractor labor, and labor-category rows as labor', () => {
    expect(isLaborBreakdownRow({ lineType: 'Section line item (labor)', category: 'Labor' })).toBe(true);
    expect(isLaborBreakdownRow({ lineType: 'Subcontractor (labor)', category: 'Subcontractor' })).toBe(true);
    expect(isLaborBreakdownRow({ lineType: 'Custom row', category: 'labor' })).toBe(true);
  });

  it('classifies materials, subcontractor materials, and equipment as non-labor', () => {
    expect(isLaborBreakdownRow({ lineType: 'Material', category: 'Lumber' })).toBe(false);
    expect(isLaborBreakdownRow({ lineType: 'Subcontractor (material)', category: 'Subcontractor' })).toBe(false);
    expect(isLaborBreakdownRow({ lineType: 'Custom row', category: 'equipment' })).toBe(false);
  });
});

describe('computeLineBreakdownTotals', () => {
  it('derives materials, labor, subtotal, tax, and grand total from the rows', () => {
    const rows = [
      mkRow({ lineType: 'Material', linePrice: 100 }),
      mkRow({ lineType: 'Subcontractor (material)', linePrice: 50 }),
      mkRow({ lineType: 'Section line item (labor)', category: 'Labor', linePrice: 200 }),
    ];
    const t = computeLineBreakdownTotals(rows);
    expect(t.materials).toBe(150);
    expect(t.labor).toBe(200);
    expect(t.subtotal).toBe(350);
    expect(t.tax).toBe(round2(150 * 0.07)); // tax on materials only
    expect(t.grandTotal).toBe(round2(350 + 150 * 0.07));
  });

  it('excludes optional rows from every total', () => {
    const rows = [
      mkRow({ lineType: 'Material', linePrice: 100 }),
      mkRow({ lineType: 'Material', linePrice: 999, optional: true }),
    ];
    const t = computeLineBreakdownTotals(rows);
    expect(t.materials).toBe(100);
    expect(t.subtotal).toBe(100);
  });

  it('honors tax exemption', () => {
    const rows = [mkRow({ lineType: 'Material', linePrice: 100 })];
    expect(computeLineBreakdownTotals(rows, { taxExempt: true }).tax).toBe(0);
  });

  it('taxes taxable materials only (taxable === false is counted in materials but not tax)', () => {
    const rows = [
      mkRow({ lineType: 'Material', linePrice: 100, taxable: true }),
      mkRow({ lineType: 'Material', linePrice: 100, taxable: false }),
    ];
    const t = computeLineBreakdownTotals(rows);
    expect(t.materials).toBe(200);
    expect(t.tax).toBe(round2(100 * 0.07));
  });

  // Regression: the proposal-software bug shipped a "Materials & subcontractors" figure that
  // did NOT equal (line items - labor). For the Odell Shop v2 export the lines summed to
  // $81,276.76 (materials $44,784.96 + labor $36,491.80), but the totals box claimed
  // materials $50,959.08 / subtotal $87,450.88. Deriving from the rows makes that impossible.
  it('matches the Odell Shop v2 line items, not the inflated totals box', () => {
    const rows = [
      mkRow({ section: 'Lumber', lineType: 'Material', linePrice: 44_000.0 }),
      mkRow({ section: 'Concrete', lineType: 'Material', linePrice: 784.96 }),
      mkRow({ section: 'Lumber', lineType: 'Section line item (labor)', category: 'Labor', linePrice: 34_800.0 }),
      mkRow({ section: 'Overhead Doors', lineType: 'Subcontractor (labor)', category: 'Subcontractor', linePrice: 1_691.8 }),
    ];
    const t = computeLineBreakdownTotals(rows);

    expect(t.materials).toBe(44_784.96);
    expect(t.labor).toBe(36_491.8);
    expect(t.subtotal).toBe(81_276.76);
    expect(t.tax).toBe(3_134.95); // 7% of materials
    expect(t.grandTotal).toBe(84_411.71);

    // The old bug must never reappear.
    expect(t.materials).not.toBe(50_959.08);
    expect(t.subtotal).not.toBe(87_450.88);
    expect(t.grandTotal).not.toBe(91_018.02);

    // Invariant that the bug violated: subtotal always equals the sum of all line prices.
    const lineSum = round2(rows.reduce((s, r) => s + r.linePrice, 0));
    expect(t.subtotal).toBe(lineSum);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
