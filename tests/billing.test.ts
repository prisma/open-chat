import { describe, expect, test } from "bun:test";
import {
  FREE_TOPUP_WAIT_DAYS,
  TOPUP_OPTIONS_USD,
  freeTopupDueAt,
  isFreeTopupDue,
  isTopupOption,
  quoteTopup,
} from "../src/shared/billing";

describe("top-up quotes", () => {
  test("adds a 10% fee on every option", () => {
    const expected = {
      5: { credit: 5_000_000, fee: 500_000, total: 5_500_000 },
      10: { credit: 10_000_000, fee: 1_000_000, total: 11_000_000 },
      20: { credit: 20_000_000, fee: 2_000_000, total: 22_000_000 },
      50: { credit: 50_000_000, fee: 5_000_000, total: 55_000_000 },
      100: { credit: 100_000_000, fee: 10_000_000, total: 110_000_000 },
    } as const;

    for (const amount of TOPUP_OPTIONS_USD) {
      const quote = quoteTopup(amount);
      expect(quote.creditMicroUsd).toBe(expected[amount].credit);
      expect(quote.feeMicroUsd).toBe(expected[amount].fee);
      expect(quote.totalMicroUsd).toBe(expected[amount].total);
    }
  });

  test("quotes convert cleanly to whole Stripe cents", () => {
    for (const amount of TOPUP_OPTIONS_USD) {
      const quote = quoteTopup(amount);
      expect(Number.isInteger(quote.creditMicroUsd / 10_000)).toBe(true);
      expect(Number.isInteger(quote.feeMicroUsd / 10_000)).toBe(true);
    }
  });

  test("only the five predefined amounts are accepted", () => {
    expect(TOPUP_OPTIONS_USD).toEqual([5, 10, 20, 50, 100]);
    expect(isTopupOption(10)).toBe(true);
    expect(isTopupOption(7)).toBe(false);
    expect(isTopupOption(-5)).toBe(false);
    expect(isTopupOption(1000)).toBe(false);
  });
});

describe("free top-up clock", () => {
  const zeroAt = new Date("2026-06-01T12:00:00.000Z");

  test("comes due one month after the balance hit zero", () => {
    expect(freeTopupDueAt(zeroAt).toISOString()).toBe(
      "2026-07-01T12:00:00.000Z",
    );
    expect(FREE_TOPUP_WAIT_DAYS).toBe(30);
  });

  test("is not due the day before, is due the day after", () => {
    expect(isFreeTopupDue(zeroAt, new Date("2026-06-30T12:00:00.000Z"))).toBe(
      false,
    );
    expect(isFreeTopupDue(zeroAt, new Date("2026-07-01T12:00:00.000Z"))).toBe(
      true,
    );
    expect(isFreeTopupDue(zeroAt, new Date("2026-08-15T00:00:00.000Z"))).toBe(
      true,
    );
  });
});
