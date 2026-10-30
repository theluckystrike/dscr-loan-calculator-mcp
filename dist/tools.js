import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, calculateDscr, maxLoanForTargetDscr, rentNeededForTargetDscr, compareScenarios, amortizationSummary, } from './core.js';
export const SERVER_NAME = 'dscr-loan-calculator-mcp';
export const SERVER_VERSION = '1.0.0';
const money = (d) => z.number().nonnegative().describe(d);
const housing = {
    annual_property_tax: money('Annual property tax in USD. Default 0, but lenders always include it.').optional(),
    annual_insurance: money('Annual hazard insurance premium in USD. Default 0, but lenders always include it.').optional(),
    monthly_hoa: money('Monthly HOA or association dues in USD. Default 0.').optional(),
    monthly_other_housing: money('Other monthly housing costs in PITIA, such as flood insurance, ground rent or special assessments. Default 0.').optional(),
};
const rate = z.number().min(0).max(30).describe('Annual note rate in percent, e.g. 7.25. Up to 3 decimals.');
const term = z.number().int().min(1).max(40).describe('Amortization term in years. Default 30.').optional();
const io = z.boolean().describe('Qualify on the interest-only payment (loan x rate / 12). Default false.').optional();
const vacancy = z.number().min(0).max(50).describe('Vacancy allowance in percent of gross rent. Default 0. Many lenders use gross rent with no vacancy.').optional();
const target = z.number().min(0.5).max(3).describe('Target DSCR, e.g. 1.25 or 1.0. Default 1.25.').optional();
const loanOrPrice = {
    loan_amount: z.number().positive().describe('Loan amount in USD. Give this, or purchase_price plus down_payment_pct.').optional(),
    purchase_price: z.number().positive().describe('Purchase price in USD. Used with down_payment_pct when loan_amount is not given.').optional(),
    down_payment_pct: z.number().min(0).max(99).describe('Down payment in percent of price, e.g. 25.').optional(),
};
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
function wrap(fn) {
    return async (args) => {
        try {
            const out = fn(args);
            return {
                content: [{ type: 'text', text: `${out.summary}\n\n${JSON.stringify(out, null, 2)}` }],
                structuredContent: out,
            };
        }
        catch (e) {
            const msg = e instanceof InputError ? e.message : `Unexpected error: ${e.message}`;
            return { content: [{ type: 'text', text: msg }], isError: true };
        }
    };
}
export function registerTools(server) {
    server.registerTool('calculate_dscr', {
        title: 'Calculate DSCR for a rental property loan',
        description: 'Debt service coverage ratio for a DSCR (investor) mortgage: qualifying rent / PITIA. Computes exact principal and interest with the annuity formula (monthly compounding, half-up cents) or the interest-only payment, adds tax, insurance, HOA and other housing costs per the Fannie Mae PITIA definition, and places the result in the common lender bands (1.25+, 1.00-1.24, 0.75-0.99, under 0.75) with sourced notes that minimums vary by lender. Returns JSON plus a plain summary and a dscrradar.com link.',
        inputSchema: {
            monthly_rent: z.number().positive().describe('Gross monthly market rent in USD (lease or appraiser rent schedule).'),
            vacancy_pct: vacancy, ...loanOrPrice, annual_rate_pct: rate, term_years: term, interest_only: io, ...housing,
        },
        annotations: { title: 'Calculate DSCR', ...RO },
    }, wrap(calculateDscr));
    server.registerTool('max_loan_for_target_dscr', {
        title: 'Largest loan that meets a target DSCR',
        description: 'Solves for the largest whole-dollar loan whose PITIA keeps the DSCR at or above a target (default 1.25), given rent, rate, term, interest-only choice, tax, insurance and HOA. Optional purchase_price and max_ltv_pct give the minimum down payment and which limit binds. Exact cents arithmetic, checked against the rounded payment.',
        inputSchema: {
            monthly_rent: z.number().positive().describe('Gross monthly market rent in USD.'),
            vacancy_pct: vacancy, target_dscr: target, annual_rate_pct: rate, term_years: term, interest_only: io, ...housing,
            purchase_price: z.number().positive().describe('Optional purchase price in USD, to report LTV and minimum down payment.').optional(),
            max_ltv_pct: z.number().min(1).max(100).describe('Optional lender LTV cap in percent, e.g. 80. Needs purchase_price.').optional(),
        },
        annotations: { title: 'Max loan for target DSCR', ...RO },
    }, wrap(maxLoanForTargetDscr));
    server.registerTool('rent_needed_for_target_dscr', {
        title: 'Rent needed to reach a target DSCR',
        description: 'Solves for the smallest monthly rent (to the cent, and rounded up to whole dollars) that reaches a target DSCR (default 1.25) for a given loan, rate, term, tax, insurance, HOA and vacancy. Also returns the rent for 0.75, 1.00 and 1.25. Rounds up, never down, so the rent always meets the target.',
        inputSchema: { ...loanOrPrice, annual_rate_pct: rate, term_years: term, interest_only: io, vacancy_pct: vacancy, target_dscr: target, ...housing },
        annotations: { title: 'Rent needed for target DSCR', ...RO },
    }, wrap(rentNeededForTargetDscr));
    server.registerTool('compare_scenarios', {
        title: 'Compare DSCR loan scenarios',
        description: 'Compares 1 to 5 financing scenarios (rate, down payment, term, interest-only) on one property: loan amount, P&I, PITIA, DSCR, lender band, rent minus PITIA and total interest over the term. Names the scenario with the highest DSCR.',
        inputSchema: {
            purchase_price: z.number().positive().describe('Purchase price in USD.'),
            monthly_rent: z.number().positive().describe('Gross monthly market rent in USD.'),
            vacancy_pct: vacancy, ...housing,
            scenarios: z.array(z.object({
                label: z.string().max(60).optional().describe('Short name, e.g. "25% down 30-yr".'),
                annual_rate_pct: rate,
                down_payment_pct: z.number().min(0).max(99).describe('Down payment in percent of price.'),
                term_years: term,
                interest_only: io,
            })).min(1).max(5).describe('1 to 5 scenarios.'),
        },
        annotations: { title: 'Compare DSCR scenarios', ...RO },
    }, wrap(compareScenarios));
    server.registerTool('amortization_summary', {
        title: 'Amortization summary for a loan',
        description: 'Exact month-by-month amortization: monthly payment, number of payments, final payment, total interest, total paid and the remaining balance after chosen years. Supports an interest-only period followed by amortization over the remaining term, as many DSCR loans use. Interest is rounded half up to the cent each month, like a lender schedule.',
        inputSchema: {
            loan_amount: z.number().positive().describe('Loan amount in USD.'),
            annual_rate_pct: rate, term_years: term,
            interest_only_years: z.number().int().min(0).max(39).describe('Interest-only years at the start, e.g. 10. Default 0. Must be less than term_years.').optional(),
            balance_after_years: z.array(z.number().int().min(1).max(40)).max(10).describe('Years after which to report the balance. Default [1, 5, 10].').optional(),
        },
        annotations: { title: 'Amortization summary', ...RO },
    }, wrap(amortizationSummary));
}
export function createServer() {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    registerTools(server);
    return server;
}
