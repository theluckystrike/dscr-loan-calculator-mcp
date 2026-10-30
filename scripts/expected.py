#!/usr/bin/env python3
"""Independent expected values for the test fixtures.

This script does NOT import or call the TypeScript code. It recomputes every expected
value with Python Decimal at 60 digits, ROUND_HALF_UP to the cent, and brute-force
searches (binary search over whole dollars / cents) instead of the closed-form solvers
used in src/core.ts. Run: python3 scripts/expected.py > test/fixtures.json
"""
import json
from decimal import Decimal as D, ROUND_HALF_UP, ROUND_FLOOR, getcontext

getcontext().prec = 60
CENT = D("0.01")


def r2(x):
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


def pmt(loan, rate_pct, years):
    n = years * 12
    if rate_pct == 0:
        return r2(D(loan) / n)
    r = D(str(rate_pct)) / 1200
    return r2(D(loan) * r / (1 - (1 + r) ** (-n)))


def io_pmt(loan, rate_pct):
    return r2(D(loan) * D(str(rate_pct)) / 1200)


def fixed(tax=0, ins=0, hoa=0, other=0):
    return r2(D(str(tax)) / 12) + r2(D(str(ins)) / 12) + D(str(hoa)) + D(str(other))


def qual(rent, vac=0):
    return r2(D(str(rent)) * (100 - D(str(vac))) / 100)


def tier(rq, pitia):
    x = rq / pitia
    if x >= D("1.25"):
        return "1.25_plus"
    if x >= 1:
        return "1.00_to_1.24"
    if x >= D("0.75"):
        return "0.75_to_0.99"
    return "under_0.75"


def trunc2(x):
    return float(x.quantize(CENT, rounding=ROUND_FLOOR))


def f(x):
    return float(x)


def dscr_case(name, rent, loan, rate, years=30, io=False, vac=0, tax=0, ins=0, hoa=0, other=0, extra=None):
    if extra:
        loan = r2(D(str(extra["purchase_price"])) * (100 - D(str(extra["down_payment_pct"]))) / 100)
    pi = io_pmt(loan, rate) if io else pmt(loan, rate, years)
    pitia = pi + fixed(tax, ins, hoa, other)
    rq = qual(rent, vac)
    inp = {"monthly_rent": rent, "loan_amount": loan, "annual_rate_pct": rate, "term_years": years,
           "interest_only": io, "vacancy_pct": vac, "annual_property_tax": tax, "annual_insurance": ins,
           "monthly_hoa": hoa, "monthly_other_housing": other}
    if extra:
        inp.update(extra)
        inp.pop("loan_amount")
    return {"name": name, "tool": "calculate_dscr", "input": inp, "expect": {
        "monthly.principal_and_interest": f(pi), "monthly.pitia": f(pitia),
        "qualifying_monthly_rent": f(rq), "dscr": trunc2(rq / pitia), "tier.code": tier(rq, pitia)}}


def max_loan_case(name, rent, rate, target, years=30, io=False, vac=0, tax=0, ins=0, hoa=0, price=None, ltv=None):
    rq = qual(rent, vac)
    fx = fixed(tax, ins, hoa)

    def ok(d):  # DSCR at loan d meets target?
        if d == 0:
            return True
        p = io_pmt(d, rate) if io else pmt(d, rate, years)
        return rq / (p + fx) >= D(str(target))

    lo, hi = 0, 100_000_000
    while lo < hi:  # largest d with ok(d)
        mid = (lo + hi + 1) // 2
        if ok(mid):
            lo = mid
        else:
            hi = mid - 1
    best = lo
    if ltv is not None:
        best = min(best, int((D(str(price)) * D(str(ltv)) / 100).quantize(D(1), rounding=ROUND_FLOOR)))
    inp = {"monthly_rent": rent, "annual_rate_pct": rate, "target_dscr": target, "term_years": years,
           "interest_only": io, "vacancy_pct": vac, "annual_property_tax": tax, "annual_insurance": ins, "monthly_hoa": hoa}
    if price is not None:
        inp["purchase_price"] = price
    if ltv is not None:
        inp["max_ltv_pct"] = ltv
    exp = {"max_loan_amount": best}
    if price is not None:
        exp["min_down_payment"] = f(max(D(0), D(str(price)) - best))
    return {"name": name, "tool": "max_loan_for_target_dscr", "input": inp, "expect": exp}


def rent_case(name, loan, rate, target, years=30, io=False, vac=0, tax=0, ins=0, hoa=0):
    pi = io_pmt(loan, rate) if io else pmt(loan, rate, years)
    pitia = pi + fixed(tax, ins, hoa)
    # smallest gross rent in cents with qual(rent)/pitia >= target, by binary search
    lo, hi = 1, 10**12
    while lo < hi:
        mid = (lo + hi) // 2
        if qual(D(mid) / 100, vac) / pitia >= D(str(target)):
            hi = mid
        else:
            lo = mid + 1
    rent = D(lo) / 100
    inp = {"loan_amount": loan, "annual_rate_pct": rate, "target_dscr": target, "term_years": years,
           "interest_only": io, "vacancy_pct": vac, "annual_property_tax": tax, "annual_insurance": ins, "monthly_hoa": hoa}
    return {"name": name, "tool": "rent_needed_for_target_dscr", "input": inp, "expect": {
        "monthly.pitia": f(pitia), "rent_needed": f(rent),
        "rent_needed_whole_dollars": int(rent.quantize(D(1), rounding="ROUND_CEILING"))}}


def schedule(loan, rate, years, io_years=0):
    n = years * 12
    io_m = io_years * 12
    pay = pmt(loan, rate, years - io_years)
    r = D(str(rate)) / 1200
    b = D(str(loan))
    tot_i = D(0)
    bal = {}
    last = D(0)
    m = 0
    for m in range(1, n + 1):
        i = r2(b * r)
        p = D(0) if m <= io_m else pay - i
        if m == n or p >= b:
            p = b
        b -= p
        tot_i += i
        last = p + i
        bal[m] = b
        if b == 0:
            break
    return pay, tot_i, last, bal, m


def amort_case(name, loan, rate, years, io_years=0, marks=(5, 10)):
    pay, tot_i, last, bal, m = schedule(loan, rate, years, io_years)
    exp = {"monthly_principal_and_interest": f(pay), "total_interest": f(tot_i),
           "final_payment": f(last), "number_of_payments": m}
    for k, y in enumerate(marks):
        exp[f"balances.{k}.balance"] = f(bal.get(y * 12, D(0)))
    return {"name": name, "tool": "amortization_summary", "input": {
        "loan_amount": loan, "annual_rate_pct": rate, "term_years": years,
        "interest_only_years": io_years, "balance_after_years": list(marks)}, "expect": exp}


def compare_case():
    price, rent, tax, ins = 400000, 3200, 4800, 1800
    sc = [(7.5, 25, 30, False), (7.0, 20, 30, False), (8.0, 30, 30, True)]
    exp = {}
    rq = qual(rent)
    fx = fixed(tax, ins)
    best, best_x = None, D(-1)
    for k, (rate, down, yrs, io) in enumerate(sc):
        loan = r2(D(price) * (100 - D(down)) / 100)
        pi = io_pmt(loan, rate) if io else pmt(loan, rate, yrs)
        pitia = pi + fx
        exp[f"scenarios.{k}.loan_amount"] = f(loan)
        exp[f"scenarios.{k}.pitia"] = f(pitia)
        exp[f"scenarios.{k}.dscr"] = trunc2(rq / pitia)
        exp[f"scenarios.{k}.tier.code"] = tier(rq, pitia)
        if rq / pitia > best_x:
            best, best_x = f"S{k + 1}", rq / pitia
    exp["highest_dscr"] = best
    return {"name": "compare 3 scenarios incl. interest-only", "tool": "compare_scenarios", "input": {
        "purchase_price": price, "monthly_rent": rent, "annual_property_tax": tax, "annual_insurance": ins,
        "scenarios": [{"label": f"S{k + 1}", "annual_rate_pct": a, "down_payment_pct": b, "term_years": c, "interest_only": d}
                      for k, (a, b, c, d) in enumerate(sc)]}, "expect": exp}


fixtures = [
    dscr_case("dscr basic 300k 7% 30y", 2500, 300000, 7, tax=3600, ins=1200),
    dscr_case("dscr 1.25+ band", 3500, 250000, 6.5, tax=3000, ins=1500, hoa=50),
    dscr_case("dscr 0.75-0.99 band", 2000, 320000, 7.75, tax=4200, ins=1800),
    dscr_case("dscr under 0.75 band", 1500, 350000, 8, tax=6000, ins=2400, hoa=200),
    dscr_case("dscr interest-only", 2800, 360000, 7.25, io=True, tax=4000, ins=1600),
    dscr_case("dscr with 5% vacancy and other costs", 3100, 280000, 6.875, vac=5, tax=3900, ins=1450, hoa=25, other=40),
    dscr_case("dscr 15-year term", 4000, 300000, 6.25, years=15, tax=3000, ins=1200),
    dscr_case("dscr 0% rate", 1000, 120000, 0, tax=1200, ins=600),
    dscr_case("dscr from price and down payment", 3000, None, 7.5, tax=4800, ins=1800,
              extra={"purchase_price": 400000, "down_payment_pct": 25}),
    max_loan_case("max loan at 1.25", 3000, 7.5, 1.25, tax=4800, ins=1800, price=400000),
    max_loan_case("max loan at 1.00 interest-only", 2500, 7, 1.0, io=True, tax=3600, ins=1200),
    max_loan_case("max loan capped by 80% LTV", 5000, 6.5, 1.0, tax=3000, ins=1200, price=300000, ltv=80),
    max_loan_case("max loan none when costs exceed rent", 800, 7, 1.25, tax=9000, ins=3000),
    rent_case("rent needed 1.25", 300000, 7, 1.25, tax=3600, ins=1200),
    rent_case("rent needed 1.00 with 8% vacancy", 250000, 7.125, 1.0, vac=8, tax=3000, ins=1500, hoa=75),
    rent_case("rent needed 1.20 interest-only", 400000, 7.5, 1.2, io=True, tax=5000, ins=2000),
    amort_case("amort 300k 7% 30y", 300000, 7, 30),
    amort_case("amort 400k 6.25% 15y", 400000, 6.25, 15, marks=(1, 5, 10, 15)),
    amort_case("amort 10-yr IO then 20-yr amortizing", 500000, 7.5, 30, io_years=10, marks=(10, 20)),
    amort_case("amort 0% 10y", 120000, 0, 10, marks=(5,)),
    compare_case(),
]

# Hand-checked anchors (widely published values; computed by hand from the annuity formula):
#   $100,000 at 6% for 30 years = $599.55 a month; $200,000 at 7% for 30 years = $1,330.60.
hand = [
    {"name": "hand: 100k 6% 30y payment 599.55", "tool": "amortization_summary",
     "input": {"loan_amount": 100000, "annual_rate_pct": 6, "term_years": 30, "balance_after_years": [30]},
     "expect": {"monthly_principal_and_interest": 599.55, "balances.0.balance": 0.0}},
    {"name": "hand: 200k 7% 30y payment 1330.60", "tool": "calculate_dscr",
     "input": {"monthly_rent": 1663.25, "loan_amount": 200000, "annual_rate_pct": 7, "term_years": 30},
     "expect": {"monthly.principal_and_interest": 1330.60, "dscr": 1.25, "tier.code": "1.25_plus"}},
]
# cross-check the hand anchors with this script's own math
assert pmt(100000, 6, 30) == D("599.55")
assert pmt(200000, 7, 30) == D("1330.60")
assert D("1663.25") / D("1330.60") >= D("1.25")

print(json.dumps(fixtures + hand, indent=1))
