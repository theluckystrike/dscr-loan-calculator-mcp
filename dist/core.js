// Pure DSCR loan math. No I/O.
//
// Conventions (stated in every result):
//   - All money is held as integer cents.
//   - Monthly rate r = annual rate / 12 (monthly compounding, nominal annual rate).
//   - Amortizing P&I = L * r / (1 - (1 + r)^-n), rounded half up to the cent. At 0% it is L / n.
//   - Interest-only payment = L * r, rounded half up to the cent.
//   - Monthly tax and insurance = annual amount / 12, each rounded half up to the cent.
//   - PITIA = P&I + tax + insurance + HOA + other housing costs (Fannie Mae Selling Guide B3-6-03).
//   - DSCR = qualifying rent / PITIA, where qualifying rent = gross rent x (1 - vacancy).
//     Tiers are decided on the exact ratio with integer arithmetic. The 2-decimal DSCR is
//     truncated, so it never shows a higher tier than the exact ratio.
export const AS_OF = '2026-10-30';
export const REPO = 'dscr-loan-calculator-mcp';
export const SITE = 'https://dscrradar.com';
export const PITIA_SOURCE = 'https://selling-guide.fanniemae.com/sel/b3-6-03/monthly-housing-expense-subject-property';
export const LENDER_SOURCES = [
    'https://griffinfunding.com/blog/dscr-loans/dscr-calculator/',
    'https://defymortgage.com/dscr-loans/',
    'https://www.lendingone.com/loan-programs/dscr-loans/',
];
export const ROUNDING = 'Monthly compounding (annual rate / 12). P&I, interest-only payment, monthly tax and monthly insurance are each rounded half up to the cent before they are added. DSCR is truncated to 2 decimals; tiers use the exact ratio.';
export const TIER_DISCLAIMER = 'DSCR minimums and pricing bands vary by lender and change over time. These tiers are common market labels, not an approval decision.';
const MAX_MONEY = 1_000_000_000;
const MAX_LOAN = 100_000_000;
const MAX_MONTHS = 480;
export class InputError extends Error {
}
export function more(path) {
    return `${SITE}${path}?utm_source=mcp&utm_medium=${REPO}`;
}
// ---------- input helpers ----------
function scaled(name, value, scale, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new InputError(`${name} must be a number.`);
    if (value < min || value > max)
        throw new InputError(`${name} must be from ${min} to ${max}. Got ${value}.`);
    const n = Math.round(value * scale);
    if (Math.abs(value * scale - n) > 1e-6) {
        throw new InputError(`${name} has too many decimal places. Use at most ${Math.round(Math.log10(scale))}.`);
    }
    return n;
}
export const cents = (name, v, min = 0, max = MAX_MONEY) => scaled(name, v, 100, min, max);
const hundredths = (name, v, min, max) => scaled(name, v, 100, min, max);
const rateThousandths = (v) => scaled('annual_rate_pct', v, 1000, 0, 30);
function termMonths(v, name = 'term_years') {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 40) {
        throw new InputError(`${name} must be a whole number of years from 1 to 40.`);
    }
    return v * 12;
}
/** Integer a*b/c rounded half up, all non-negative. */
function mulDivHalfUp(a, b, c) {
    return Math.floor((2 * a * b + c) / (2 * c));
}
export const dollars = (c) => Math.round(c) / 100;
const fmt = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// ---------- payment math ----------
/** One month of interest on balance (cents) at rate in thousandths of a percent. */
export function monthlyInterest(balanceCents, rt) {
    return mulDivHalfUp(balanceCents, rt, 1_200_000);
}
/** Amortizing monthly P&I in cents. */
export function amortizingPayment(loanCents, rt, months) {
    if (rt === 0)
        return Math.round(loanCents / months);
    const r = rt / 1_200_000;
    return Math.round((loanCents * r) / (1 - Math.pow(1 + r, -months)));
}
function readHousing(i) {
    return {
        taxCents: cents('annual_property_tax', i.annual_property_tax ?? 0),
        insCents: cents('annual_insurance', i.annual_insurance ?? 0),
        hoaCents: cents('monthly_hoa', i.monthly_hoa ?? 0),
        otherCents: cents('monthly_other_housing', i.monthly_other_housing ?? 0),
    };
}
function monthlyFixed(h) {
    const tax = Math.round(h.taxCents / 12);
    const ins = Math.round(h.insCents / 12);
    return { tax, ins, hoa: h.hoaCents, other: h.otherCents, total: tax + ins + h.hoaCents + h.otherCents };
}
function readLoan(i) {
    if (i.loan_amount !== undefined) {
        return { loanCents: cents('loan_amount', i.loan_amount, 1000, MAX_LOAN), priceCents: null, downH: null };
    }
    if (i.purchase_price === undefined || i.down_payment_pct === undefined) {
        throw new InputError('Give loan_amount, or give both purchase_price and down_payment_pct.');
    }
    const priceCents = cents('purchase_price', i.purchase_price, 1000);
    const downH = hundredths('down_payment_pct', i.down_payment_pct, 0, 99);
    const loanCents = mulDivHalfUp(priceCents, 10000 - downH, 10000);
    if (loanCents < 100_000 || loanCents > MAX_LOAN * 100)
        throw new InputError('The loan must be from $1,000 to $100,000,000.');
    return { loanCents, priceCents, downH };
}
function qualifyingRent(rentCents, vacH) {
    return mulDivHalfUp(rentCents, 10000 - vacH, 10000);
}
export function tierFor(rentQ, pitia) {
    if (rentQ * 100 >= pitia * 125)
        return { code: '1.25_plus', label: '1.25 or higher', note: 'Rent covers PITIA with at least a 25% cushion. Many lenders look for at least 1.25, and this band may support better pricing.' };
    if (rentQ >= pitia)
        return { code: '1.00_to_1.24', label: '1.00 to 1.24', note: 'Rent covers PITIA. Many DSCR programs accept 1.00 or more; lenders that want 1.25 will not.' };
    if (rentQ * 100 >= pitia * 75)
        return { code: '0.75_to_0.99', label: '0.75 to 0.99', note: 'Rent does not cover PITIA. Some lenders still lend down to 0.75, often with reserves or more equity.' };
    return { code: 'under_0.75', label: 'under 0.75', note: 'Well below break-even. Usually only no-ratio programs, which are lender-specific, are left.' };
}
function dscrNumbers(rentQ, pitia) {
    return {
        dscr: Math.floor((rentQ * 100) / pitia) / 100,
        dscr_exact: Math.round((rentQ / pitia) * 1e6) / 1e6,
    };
}
function common(path) {
    return { rounding: ROUNDING, tiers_vary_by_lender: TIER_DISCLAIMER, lender_sources: LENDER_SOURCES, as_of: AS_OF, source: PITIA_SOURCE, more: more(path) };
}
function ioCheck(io, rt) {
    if (io && rt === 0)
        throw new InputError('An interest-only loan at 0% has no payment. Use a rate above 0.');
}
function piFor(loanCents, rt, months, io) {
    return io ? monthlyInterest(loanCents, rt) : amortizingPayment(loanCents, rt, months);
}
// ---------- tool 1: calculate_dscr ----------
export function calculateDscr(i) {
    const rentCents = cents('monthly_rent', i.monthly_rent, 1);
    const vacH = hundredths('vacancy_pct', i.vacancy_pct ?? 0, 0, 50);
    const { loanCents, priceCents } = readLoan(i);
    const rt = rateThousandths(i.annual_rate_pct);
    const months = termMonths(i.term_years ?? 30);
    const io = i.interest_only === true;
    ioCheck(io, rt);
    const fixed = monthlyFixed(readHousing(i));
    const amort = amortizingPayment(loanCents, rt, months);
    const pi = io ? monthlyInterest(loanCents, rt) : amort;
    const pitia = pi + fixed.total;
    const rentQ = qualifyingRent(rentCents, vacH);
    const d = dscrNumbers(rentQ, pitia);
    const tier = tierFor(rentQ, pitia);
    const amortPitia = amort + fixed.total;
    const result = {
        loan_amount: dollars(loanCents),
        purchase_price: priceCents === null ? null : dollars(priceCents),
        annual_rate_pct: rt / 1000,
        term_years: months / 12,
        interest_only: io,
        gross_monthly_rent: dollars(rentCents),
        vacancy_pct: vacH / 100,
        qualifying_monthly_rent: dollars(rentQ),
        monthly: {
            principal_and_interest: dollars(pi),
            property_tax: dollars(fixed.tax),
            insurance: dollars(fixed.ins),
            hoa: dollars(fixed.hoa),
            other_housing: dollars(fixed.other),
            pitia: dollars(pitia),
        },
        dscr: d.dscr,
        dscr_exact: d.dscr_exact,
        tier,
        monthly_rent_minus_pitia: dollars(rentQ - pitia),
        amortizing_comparison: io ? {
            amortizing_principal_and_interest: dollars(amort),
            pitia: dollars(amortPitia),
            dscr: dscrNumbers(rentQ, amortPitia).dscr,
            note: 'Some lenders qualify interest-only loans on the interest-only payment, others on the amortizing payment.',
        } : null,
        formula: 'DSCR = gross rent x (1 - vacancy) / PITIA',
        ...common('/dscr-loan-calculator/'),
    };
    const warn = fixed.tax === 0 && fixed.ins === 0 ? ' Taxes and insurance were 0, so PITIA is only the loan payment plus dues; lenders always include them.' : '';
    const summary = `A ${fmt(loanCents)} loan at ${rt / 1000}% over ${months / 12} years${io ? ' (interest-only)' : ''} has a monthly payment of ${fmt(pi)} and PITIA of ${fmt(pitia)}. Qualifying rent of ${fmt(rentQ)} gives a DSCR of ${d.dscr.toFixed(2)} (exact ${d.dscr_exact}), in the ${tier.label} band. ${tier.note} ${TIER_DISCLAIMER}${warn}`;
    return { ...result, summary };
}
// ---------- tool 2: max_loan_for_target_dscr ----------
function largestLoanDollars(maxPi, rt, months, io) {
    const pay = (d) => piFor(d * 100, rt, months, io);
    const factor = io ? rt / 1_200_000 : (rt === 0 ? 1 / months : (rt / 1_200_000) / (1 - Math.pow(1 + rt / 1_200_000, -months)));
    let d = Math.max(0, Math.floor(maxPi / 100 / factor));
    for (let k = 0; k < 1000 && d > 0 && pay(d) > maxPi; k++)
        d--;
    for (let k = 0; k < 1000 && pay(d + 1) <= maxPi; k++)
        d++;
    return d;
}
export function maxLoanForTargetDscr(i) {
    const rentCents = cents('monthly_rent', i.monthly_rent, 1);
    const vacH = hundredths('vacancy_pct', i.vacancy_pct ?? 0, 0, 50);
    const th = hundredths('target_dscr', i.target_dscr ?? 1.25, 0.5, 3);
    const rt = rateThousandths(i.annual_rate_pct);
    const months = termMonths(i.term_years ?? 30);
    const io = i.interest_only === true;
    ioCheck(io, rt);
    const fixed = monthlyFixed(readHousing(i));
    const priceCents = i.purchase_price === undefined ? null : cents('purchase_price', i.purchase_price, 1000);
    const ltvH = i.max_ltv_pct === undefined ? null : hundredths('max_ltv_pct', i.max_ltv_pct, 1, 100);
    if (ltvH !== null && priceCents === null)
        throw new InputError('max_ltv_pct needs purchase_price.');
    const rentQ = qualifyingRent(rentCents, vacH);
    const maxPitia = Math.floor((rentQ * 100) / th);
    const maxPi = maxPitia - fixed.total;
    const dscrMax = maxPi <= 0 ? 0 : Math.min(largestLoanDollars(maxPi, rt, months, io), MAX_LOAN);
    const ltvMax = ltvH !== null && priceCents !== null ? Math.floor(mulDivHalfUp(priceCents, ltvH, 10000) / 100) : null;
    const loanD = ltvMax !== null ? Math.min(dscrMax, ltvMax) : dscrMax;
    const binding = ltvMax !== null && ltvMax < dscrMax ? 'max_ltv_pct' : 'target_dscr';
    const pi = loanD > 0 ? piFor(loanD * 100, rt, months, io) : 0;
    const pitia = pi + fixed.total;
    const result = {
        target_dscr: th / 100,
        qualifying_monthly_rent: dollars(rentQ),
        max_pitia_at_target: dollars(maxPitia),
        monthly_tax_insurance_hoa_other: dollars(fixed.total),
        max_principal_and_interest: dollars(Math.max(0, maxPi)),
        max_loan_amount: loanD,
        max_loan_by_dscr: dscrMax,
        max_loan_by_ltv: ltvMax,
        binding_constraint: binding,
        at_max_loan: loanD > 0 ? { principal_and_interest: dollars(pi), pitia: dollars(pitia), dscr: dscrNumbers(rentQ, pitia).dscr, dscr_exact: dscrNumbers(rentQ, pitia).dscr_exact } : null,
        purchase_price: priceCents === null ? null : dollars(priceCents),
        ltv_pct: priceCents === null || loanD === 0 ? null : Math.round((loanD * 100 / priceCents) * 10000) / 100,
        min_down_payment: priceCents === null ? null : Math.max(0, dollars(priceCents - loanD * 100)),
        annual_rate_pct: rt / 1000, term_years: months / 12, interest_only: io,
        method: 'Largest whole-dollar loan whose rounded P&I plus tax, insurance, HOA and other costs keeps qualifying rent / PITIA at or above the target.',
        ...common('/dscr-loan-down-payment/'),
    };
    const summary = maxPi <= 0
        ? `At a target DSCR of ${(th / 100).toFixed(2)}, qualifying rent of ${fmt(rentQ)} supports PITIA of at most ${fmt(maxPitia)}, but tax, insurance, HOA and other costs already take ${fmt(fixed.total)}. No loan meets the target. ${TIER_DISCLAIMER}`
        : `At a target DSCR of ${(th / 100).toFixed(2)}, qualifying rent of ${fmt(rentQ)} supports PITIA up to ${fmt(maxPitia)}, which leaves ${fmt(maxPi)} for principal and interest. At ${rt / 1000}% over ${months / 12} years${io ? ' interest-only' : ''}, the largest loan is $${loanD.toLocaleString('en-US')}${binding === 'max_ltv_pct' ? ' (capped by the LTV limit)' : ''}${priceCents !== null ? `, which needs a down payment of at least ${fmt(Math.max(0, priceCents - loanD * 100))} on a ${fmt(priceCents)} purchase` : ''}. ${TIER_DISCLAIMER}`;
    return { ...result, summary };
}
// ---------- tool 3: rent_needed_for_target_dscr ----------
function grossRentFor(reqQ, vacH) {
    let g = Math.ceil((reqQ * 10000) / (10000 - vacH));
    for (let k = 0; k < 100 && g > 0 && qualifyingRent(g - 1, vacH) >= reqQ; k++)
        g--;
    for (let k = 0; k < 100 && qualifyingRent(g, vacH) < reqQ; k++)
        g++;
    return g;
}
export function rentNeededForTargetDscr(i) {
    const vacH = hundredths('vacancy_pct', i.vacancy_pct ?? 0, 0, 50);
    const th = hundredths('target_dscr', i.target_dscr ?? 1.25, 0.5, 3);
    const { loanCents } = readLoan(i);
    const rt = rateThousandths(i.annual_rate_pct);
    const months = termMonths(i.term_years ?? 30);
    const io = i.interest_only === true;
    ioCheck(io, rt);
    const fixed = monthlyFixed(readHousing(i));
    const pi = piFor(loanCents, rt, months, io);
    const pitia = pi + fixed.total;
    const forTarget = (t) => {
        const reqQ = Math.ceil((pitia * t) / 100);
        const g = grossRentFor(reqQ, vacH);
        return { target_dscr: t / 100, qualifying_rent: dollars(reqQ), gross_rent: dollars(g), gross_rent_whole_dollars: Math.ceil(g / 100) };
    };
    const main = forTarget(th);
    const result = {
        loan_amount: dollars(loanCents), annual_rate_pct: rt / 1000, term_years: months / 12, interest_only: io,
        vacancy_pct: vacH / 100,
        monthly: { principal_and_interest: dollars(pi), property_tax: dollars(fixed.tax), insurance: dollars(fixed.ins), hoa: dollars(fixed.hoa), other_housing: dollars(fixed.other), pitia: dollars(pitia) },
        target_dscr: th / 100,
        rent_needed: main.gross_rent,
        rent_needed_whole_dollars: main.gross_rent_whole_dollars,
        qualifying_rent_needed: main.qualifying_rent,
        common_targets: [75, 100, 125].map(forTarget),
        method: 'Smallest rent in cents whose qualifying rent (after vacancy, rounded half up) divided by PITIA is at or above the target. Rounded up, never down.',
        ...common('/rent-to-qualify/'),
    };
    const summary = `PITIA on a ${fmt(loanCents)} loan at ${rt / 1000}% over ${months / 12} years${io ? ' interest-only' : ''} is ${fmt(pitia)} a month. To reach a DSCR of ${(th / 100).toFixed(2)}${vacH ? ` after ${vacH / 100}% vacancy` : ''}, the property needs gross rent of at least ${fmt(main.gross_rent * 100)} a month ($${main.gross_rent_whole_dollars.toLocaleString('en-US')} in whole dollars). Break-even (1.00) needs ${fmt(result.common_targets[1].gross_rent * 100)}. ${TIER_DISCLAIMER}`;
    return { ...result, summary };
}
export function runSchedule(loanCents, rt, months, ioMonths, marks) {
    const payment = amortizingPayment(loanCents, rt, months - ioMonths);
    let b = loanCents;
    let paidP = 0;
    let paidI = 0;
    let last = 0;
    let m = 0;
    const balances = new Map();
    const want = new Set(marks.map((y) => y * 12));
    for (m = 1; m <= MAX_MONTHS && b > 0; m++) {
        const int = monthlyInterest(b, rt);
        let prin = m <= ioMonths ? 0 : payment - int;
        if (m === months || prin >= b)
            prin = b;
        b -= prin;
        paidP += prin;
        paidI += int;
        last = prin + int;
        if (want.has(m))
            balances.set(m / 12, { balance: b, principal: paidP, interest: paidI });
    }
    for (const y of marks)
        if (!balances.has(y))
            balances.set(y, { balance: 0, principal: paidP, interest: paidI });
    return { payment, ioPayment: ioMonths > 0 ? monthlyInterest(loanCents, rt) : null, months: m - 1, lastPayment: last, totalInterest: paidI, balances };
}
export function amortizationSummary(i) {
    const loanCents = cents('loan_amount', i.loan_amount, 1000, MAX_LOAN);
    const rt = rateThousandths(i.annual_rate_pct);
    const months = termMonths(i.term_years ?? 30);
    const ioYears = i.interest_only_years ?? 0;
    if (typeof ioYears !== 'number' || !Number.isInteger(ioYears) || ioYears < 0 || ioYears * 12 >= months) {
        throw new InputError('interest_only_years must be a whole number from 0 up to one less than term_years.');
    }
    if (ioYears > 0 && rt === 0)
        throw new InputError('An interest-only period at 0% has no payment. Use a rate above 0.');
    const raw = Array.isArray(i.balance_after_years) ? i.balance_after_years : [1, 5, 10];
    if (raw.length > 10 || raw.some((y) => typeof y !== 'number' || !Number.isInteger(y) || y < 1 || y > 40)) {
        throw new InputError('balance_after_years must be up to 10 whole numbers from 1 to 40.');
    }
    const marks = [...new Set(raw)].filter((y) => y * 12 <= months).sort((a, b) => a - b);
    const s = runSchedule(loanCents, rt, months, ioYears * 12, marks);
    const total = loanCents + s.totalInterest;
    const result = {
        loan_amount: dollars(loanCents), annual_rate_pct: rt / 1000, term_years: months / 12, interest_only_years: ioYears,
        interest_only_payment: s.ioPayment === null ? null : dollars(s.ioPayment),
        monthly_principal_and_interest: dollars(s.payment),
        amortizing_months: months - ioYears * 12,
        number_of_payments: s.months,
        final_payment: dollars(s.lastPayment),
        total_interest: dollars(s.totalInterest),
        total_paid: dollars(total),
        balances: marks.map((y) => { const v = s.balances.get(y); return { after_years: y, balance: dollars(v.balance), principal_paid: dollars(v.principal), interest_paid: dollars(v.interest) }; }),
        method: 'Month-by-month schedule. Each month interest = balance x rate / 12, rounded half up to the cent; principal = payment - interest. The final payment clears the remaining balance.',
        rounding: ROUNDING, as_of: AS_OF, source: PITIA_SOURCE, more: more('/investment-property-calculator/'),
    };
    const bal = result.balances.map((b) => `${fmt(b.balance * 100)} after ${b.after_years} year${b.after_years === 1 ? '' : 's'}`).join(', ');
    const summary = `A ${fmt(loanCents)} loan at ${rt / 1000}% over ${months / 12} years${ioYears ? `, interest-only for the first ${ioYears} years at ${fmt(s.ioPayment)} a month, then` : ''} has a principal and interest payment of ${fmt(s.payment)} a month${ioYears ? ` for ${months - ioYears * 12} months` : ''}. Total interest over the full term is ${fmt(s.totalInterest)} and total paid is ${fmt(total)}; the final payment is ${fmt(s.lastPayment)}.${bal ? ` Remaining balance: ${bal}.` : ''}`;
    return { ...result, summary };
}
// ---------- tool 4: compare_scenarios ----------
export function compareScenarios(i) {
    const priceCents = cents('purchase_price', i.purchase_price, 1000);
    const rentCents = cents('monthly_rent', i.monthly_rent, 1);
    const vacH = hundredths('vacancy_pct', i.vacancy_pct ?? 0, 0, 50);
    const fixed = monthlyFixed(readHousing(i));
    const list = i.scenarios;
    if (!Array.isArray(list) || list.length < 1 || list.length > 5)
        throw new InputError('scenarios must hold 1 to 5 items.');
    const rentQ = qualifyingRent(rentCents, vacH);
    const rows = list.map((sRaw, idx) => {
        const s = sRaw;
        const { loanCents } = readLoan({ purchase_price: i.purchase_price, down_payment_pct: s.down_payment_pct });
        const rt = rateThousandths(s.annual_rate_pct);
        const months = termMonths(s.term_years ?? 30);
        const io = s.interest_only === true;
        ioCheck(io, rt);
        const pi = piFor(loanCents, rt, months, io);
        const pitia = pi + fixed.total;
        const d = dscrNumbers(rentQ, pitia);
        const sched = io ? null : runSchedule(loanCents, rt, months, 0, []);
        return {
            label: typeof s.label === 'string' && s.label ? s.label : `Scenario ${idx + 1}`,
            annual_rate_pct: rt / 1000, down_payment_pct: Number(s.down_payment_pct), term_years: months / 12, interest_only: io,
            down_payment: dollars(priceCents - loanCents), loan_amount: dollars(loanCents),
            principal_and_interest: dollars(pi), pitia: dollars(pitia),
            dscr: d.dscr, dscr_exact: d.dscr_exact, tier: tierFor(rentQ, pitia),
            monthly_rent_minus_pitia: dollars(rentQ - pitia),
            total_interest_full_term: sched ? dollars(sched.totalInterest) : null,
            _ratio: rentQ / pitia,
        };
    });
    const best = rows.reduce((a, b) => (b._ratio > a._ratio ? b : a));
    const scenarios = rows.map(({ _ratio, ...r }) => r);
    const result = {
        purchase_price: dollars(priceCents), gross_monthly_rent: dollars(rentCents), vacancy_pct: vacH / 100,
        qualifying_monthly_rent: dollars(rentQ),
        monthly_tax_insurance_hoa_other: dollars(fixed.total),
        scenarios,
        highest_dscr: best.label,
        ...common('/dscr-loan-rates/'),
    };
    const lines = scenarios.map((r) => `${r.label}: ${r.annual_rate_pct}%, ${r.down_payment_pct}% down, ${r.term_years} yr${r.interest_only ? ' IO' : ''} gives PITIA ${fmt(r.pitia * 100)} and DSCR ${r.dscr.toFixed(2)} (${r.tier.label})`).join('; ');
    const summary = `On a ${fmt(priceCents)} purchase with qualifying rent of ${fmt(rentQ)} a month: ${lines}. The highest DSCR is ${best.label}. ${TIER_DISCLAIMER}`;
    return { ...result, summary };
}
