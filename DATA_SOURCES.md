# Data sources

All pages were fetched on 2026-10-30. No number in the server comes from model memory.

| Source | URL | Used for |
| --- | --- | --- |
| Fannie Mae Selling Guide B3-6-03, Monthly Housing Expense for the Subject Property | https://selling-guide.fanniemae.com/sel/b3-6-03/monthly-housing-expense-subject-property | Definition of PITIA: P&I, property, flood and mortgage insurance, real estate taxes, ground rent, special assessments, owners' association dues, co-op fees, subordinate financing payments. |
| Griffin Funding, DSCR calculator | https://griffinfunding.com/blog/dscr-loans/dscr-calculator/ | DSCR as gross qualifying rent / PITIA with no vacancy deduction; bands 1.25+, 1.00 to 1.24, 0.75 to 0.99, below 0.75; "Many lenders look for at least 1.25"; no-ratio programs exist; other lenders subtract vacancy or expenses first. |
| Defy Mortgage, DSCR loans | https://defymortgage.com/dscr-loans/ | "Most lenders look for a DSCR ratio of at least 1.25"; Defy offers DSCR loans down to a 0.75 minimum; up to 85% LTV on SFR purchases ("most lenders only go up to 80%"). |
| LendingOne, DSCR loans | https://www.lendingone.com/loan-programs/dscr-loans/ | DSCR = monthly rental income / monthly debt obligations; 1.0 is break-even; "Lenders each have varying thresholds for DSCR ratios, so it's still possible to get approved below 1.0." |
| dscrradar.com source (rent-to-qualify and deal calculators) | https://dscrradar.com/rent-to-qualify/ | Integer-cents convention and the annuity payment factor, reused and re-verified here. |

## Formula

Standard level-payment annuity with monthly compounding of a nominal annual rate:

P&I = L x r / (1 - (1 + r)^-n), where r = annual rate / 12 and n = term in months.

Hand anchors used in the tests: $100,000 at 6% for 30 years is $599.55 a month; $200,000 at 7% for 30 years is $1,330.60 a month.
