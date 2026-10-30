import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../dist/core.js';

// Expected values come from scripts/expected.py (Python Decimal, brute-force search),
// never from the code under test.
const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const fns = {
  calculate_dscr: core.calculateDscr,
  max_loan_for_target_dscr: core.maxLoanForTargetDscr,
  rent_needed_for_target_dscr: core.rentNeededForTargetDscr,
  compare_scenarios: core.compareScenarios,
  amortization_summary: core.amortizationSummary,
};
const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);

for (const fx of fixtures) {
  test(`fixture: ${fx.name}`, () => {
    const out = fns[fx.tool](fx.input);
    for (const [path, want] of Object.entries(fx.expect)) {
      assert.deepEqual(get(out, path), want, `${fx.name} -> ${path}`);
    }
    assert.ok(out.summary.length > 40);
    assert.match(out.more, /^https:\/\/dscrradar\.com\/.*utm_source=mcp&utm_medium=dscr-loan-calculator-mcp$/);
    assert.equal(out.as_of, '2026-10-30');
    assert.match(out.source, /^https:\/\//);
  });
}

test('fixture count is at least 15', () => assert.ok(fixtures.length >= 15, String(fixtures.length)));

test('errors are InputError with clear text', () => {
  assert.throws(() => core.calculateDscr({ monthly_rent: 2000, annual_rate_pct: 7 }), /loan_amount, or give both/);
  assert.throws(() => core.calculateDscr({ monthly_rent: 2000, loan_amount: 200000, annual_rate_pct: 31 }), /annual_rate_pct must be from 0 to 30/);
  assert.throws(() => core.calculateDscr({ monthly_rent: 2000.123, loan_amount: 200000, annual_rate_pct: 7 }), /decimal places/);
  assert.throws(() => core.calculateDscr({ monthly_rent: 2000, loan_amount: 200000, annual_rate_pct: 0, interest_only: true }), /interest-only/i);
  assert.throws(() => core.amortizationSummary({ loan_amount: 200000, annual_rate_pct: 7, term_years: 30, interest_only_years: 30 }), /interest_only_years/);
  assert.throws(() => core.compareScenarios({ purchase_price: 300000, monthly_rent: 2000, scenarios: [] }), /1 to 5/);
});

test('tier boundary is exact, not rounded', () => {
  // PITIA 1000.00, rent 1249.99 is 1.24999 -> 1.00_to_1.24, rent 1250.00 -> 1.25_plus
  assert.equal(core.tierFor(124999, 100000).code, '1.00_to_1.24');
  assert.equal(core.tierFor(125000, 100000).code, '1.25_plus');
  assert.equal(core.tierFor(99999, 100000).code, '0.75_to_0.99');
  assert.equal(core.tierFor(74999, 100000).code, 'under_0.75');
});
