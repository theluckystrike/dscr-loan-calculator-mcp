# DSCR Loan Calculator MCP

Exact DSCR loan math for AI assistants: debt service coverage ratio, max loan, rent needed, scenario comparison and amortization for rental property loans.

Hosted MCP URL (no sign-in, no token): `https://dscr-loan-calculator-mcp.lipmichal.workers.dev/mcp`

Money site with the full calculators and rate pages: [dscrradar.com](https://dscrradar.com/dscr-loan-calculator/?utm_source=github&utm_medium=dscr-loan-calculator-mcp)

## Tools

| Tool | What it does |
| --- | --- |
| `calculate_dscr` | DSCR = qualifying rent / PITIA. Exact P&I or interest-only payment, tax, insurance, HOA and other housing costs, and the lender band (1.25+, 1.00-1.24, 0.75-0.99, under 0.75). |
| `max_loan_for_target_dscr` | Largest whole-dollar loan that keeps DSCR at or above a target. Optional purchase price and LTV cap give the minimum down payment and which limit binds. |
| `rent_needed_for_target_dscr` | Smallest monthly rent that reaches a target DSCR, plus the rent for 0.75, 1.00 and 1.25. |
| `compare_scenarios` | Up to 5 rate, down payment, term and interest-only scenarios side by side, with DSCR, band, rent minus PITIA and total interest. |
| `amortization_summary` | Monthly payment, number of payments, final payment, total interest, total paid and balance after N years. Supports an interest-only period first. |

Every result has structured JSON, a one-paragraph summary, an `as_of` date, a `source` URL and a `more` link to the matching dscrradar.com page.

## What it knows that your model does not

- Cent-exact payments. Language models often get the annuity formula wrong by a few dollars, or round in the wrong place. This server uses the standard annuity formula with monthly compounding and rounds each part half up to the cent, the way a lender schedule does.
- The real definition of PITIA (Fannie Mae Selling Guide B3-6-03): principal, interest, taxes, insurance, association dues, ground rent, special assessments.
- Exact tier edges. A DSCR of 1.2499 is not 1.25. Tiers are decided on the exact ratio with integer math, and the 2-decimal DSCR is truncated, not rounded up.
- Solvers. Max loan and rent needed are solved exactly against the rounded payment, not estimated.
- How lenders actually differ. Some lenders look for 1.25, some accept 1.00, some go down to 0.75, and some offer no-ratio programs. Sources are in each result.

## Install

### Claude.ai custom connector, ChatGPT developer mode

Paste this URL as a custom connector. No token or sign-in.

```
https://dscr-loan-calculator-mcp.lipmichal.workers.dev/mcp
```

### Claude Code

```
claude mcp add --transport http dscr-loan-calculator https://dscr-loan-calculator-mcp.lipmichal.workers.dev/mcp
```

Or run it locally over stdio:

```
claude mcp add dscr-loan-calculator -- npx -y github:theluckystrike/dscr-loan-calculator-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dscr-loan-calculator": {
      "command": "npx",
      "args": ["-y", "github:theluckystrike/dscr-loan-calculator-mcp"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "dscr-loan-calculator": { "url": "https://dscr-loan-calculator-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "dscr-loan-calculator": { "type": "http", "url": "https://dscr-loan-calculator-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Test with curl

```
curl -s -X POST https://dscr-loan-calculator-mcp.lipmichal.workers.dev/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"calculate_dscr","arguments":{"monthly_rent":2500,"loan_amount":300000,"annual_rate_pct":7,"annual_property_tax":3600,"annual_insurance":1200}}}'
```

## Example prompts

- "Rent is $2,500, the loan is $300,000 at 7% for 30 years, taxes $3,600 a year and insurance $1,200. What is my DSCR?"
- "What is the biggest DSCR loan I can get on a $400,000 rental that rents for $3,000, at 7.5%, if the lender wants 1.25?"
- "How much rent do I need for a 1.25 DSCR on a $300,000 loan at 7%?"
- "Compare 20% down at 7%, 25% down at 7.5% and 30% down interest-only at 8% on a $400,000 property renting for $3,200."
- "Show the balance after 10 and 20 years on a $500,000 loan at 7.5%, 10 years interest-only then 20 years amortizing."

## Math and rounding

- Monthly rate = annual rate / 12. P&I = L x r / (1 - (1 + r)^-n). At 0%, P&I = L / n.
- Interest-only payment = L x r.
- Monthly tax and insurance = annual amount / 12.
- Each of these is rounded half up to the cent before they are added into PITIA.
- Qualifying rent = gross rent x (1 - vacancy), rounded half up to the cent. Vacancy defaults to 0, because many DSCR lenders use gross rent.
- DSCR = qualifying rent / PITIA. Shown truncated to 2 decimals and as an exact ratio to 6 decimals.
- Amortization runs month by month. Interest is rounded half up to the cent each month and the final payment clears the balance.

23 test fixtures check these numbers. The expected values come from a separate Python Decimal script (`scripts/expected.py`) that uses brute-force search, not from the server code.

## Data sources

See [DATA_SOURCES.md](DATA_SOURCES.md). In short, the PITIA definition is from the Fannie Mae Selling Guide, and the lender bands are from Griffin Funding, Defy Mortgage and LendingOne pages fetched on 2026-10-30.

## Limitations

- This is math, not a loan offer or approval. Lender minimums, rate pricing, reserve rules and LTV caps vary by lender and change often.
- DSCR here is the residential DSCR-loan measure (rent / PITIA). Commercial lenders often use NOI / annual debt service instead. Some lenders subtract vacancy or expenses first; use `vacancy_pct` and `monthly_other_housing` to model that.
- Some lenders qualify interest-only loans on the amortizing payment. `calculate_dscr` shows both when `interest_only` is true.
- The server does not quote live rates. Current DSCR rate pages are on [dscrradar.com](https://dscrradar.com/dscr-loan-rates/?utm_source=github&utm_medium=dscr-loan-calculator-mcp).

## Development

```
npm install
npm run build
npm test
npx wrangler deploy
```

`src/core.ts` holds the pure math. `src/stdio.ts` and `src/worker.ts` are thin entries over the same tool registry in `src/tools.ts`.

## License

MIT

Part of the Zovo MCP collection: https://mcp.zovo.one
