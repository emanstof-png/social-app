import { describe, expect, it } from "vitest";

import {
  ASSESSMENT_CATALOGUE,
  CATALOGUE_IDS,
  RESPONSE_CHOICES,
  RESPONSE_MAX,
  RESPONSE_MIN,
  inventoryById,
  scoreInventory,
} from "@/lib/assessments/catalogue";

/**
 * Spec 03 item 1. Scoring is deterministic code, never a model call, so it is
 * testable in full: the same responses must always produce the same scores.
 *
 * Red before green (CLAUDE.md): this file was written and run against a missing
 * module before lib/assessments/catalogue.ts existed.
 */

/** Every item answered with the same value. */
function uniform(inventoryId: string, value: number): Record<string, number> {
  const inventory = inventoryById(inventoryId);
  return Object.fromEntries(inventory.items.map((item) => [item.id, value]));
}

describe("catalogue shape", () => {
  it("ships the four inventories the spec names", () => {
    expect([...CATALOGUE_IDS].sort()).toEqual(
      ["behavioural_profile", "big_five", "core_motivations", "social_style"].sort(),
    );
  });

  it.each(ASSESSMENT_CATALOGUE)("$id has 8-12 items", (inventory) => {
    expect(inventory.items.length).toBeGreaterThanOrEqual(8);
    expect(inventory.items.length).toBeLessThanOrEqual(12);
  });

  it.each(ASSESSMENT_CATALOGUE)("$id says what it measures", (inventory) => {
    expect(inventory.name.length).toBeGreaterThan(0);
    expect(inventory.measures.length).toBeGreaterThan(0);
  });

  it.each(ASSESSMENT_CATALOGUE)("$id has unique item ids", (inventory) => {
    const ids = inventory.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has globally unique item ids, since answers are keyed by them", () => {
    const ids = ASSESSMENT_CATALOGUE.flatMap((inventory) =>
      inventory.items.map((item) => item.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ASSESSMENT_CATALOGUE)("$id scores every item onto a declared scale", (inventory) => {
    const declared = new Set(inventory.scales.map((scale) => scale.key));
    for (const item of inventory.items) {
      expect(declared.has(item.scale), `${item.id} -> ${item.scale}`).toBe(true);
    }
  });

  it.each(ASSESSMENT_CATALOGUE)("$id gives every scale at least one item", (inventory) => {
    const used = new Set(inventory.items.map((item) => item.scale));
    for (const scale of inventory.scales) {
      expect(used.has(scale.key), `${inventory.id}.${scale.key}`).toBe(true);
    }
  });

  it("offers one response choice per point on the scale", () => {
    expect(RESPONSE_CHOICES).toHaveLength(RESPONSE_MAX - RESPONSE_MIN + 1);
  });

  it("raises on an unknown inventory id rather than returning undefined", () => {
    expect(() => inventoryById("astrology")).toThrow(/astrology/);
  });
});

describe("scoring is deterministic and pure", () => {
  it("returns the same result for the same responses", () => {
    const responses = uniform("big_five", 4);
    expect(scoreInventory("big_five", responses)).toEqual(
      scoreInventory("big_five", responses),
    );
  });

  it("does not mutate the responses it is given", () => {
    const responses = uniform("social_style", 3);
    const before = JSON.stringify(responses);
    scoreInventory("social_style", responses);
    expect(JSON.stringify(responses)).toBe(before);
  });

  it("puts the top of the scale at 100 percent and the bottom at 0", () => {
    const high = scoreInventory("behavioural_profile", uniform("behavioural_profile", 5));
    for (const scale of high.scales) {
      // Reverse-keyed items pull the other way, so a scale is only at 100 when
      // every one of its items points the same direction.
      const inventory = inventoryById("behavioural_profile");
      const reversed = inventory.items.some(
        (item) => item.scale === scale.key && item.reverse,
      );
      if (!reversed) expect(scale.percent).toBe(100);
    }

    const low = scoreInventory("core_motivations", uniform("core_motivations", 1));
    for (const scale of low.scales) expect(scale.percent).toBe(0);
  });

  it("scores a reverse-keyed item against its scale", () => {
    const inventory = inventoryById("big_five");
    const reversed = inventory.items.find((item) => item.reverse);
    expect(reversed, "big_five should contain reverse-keyed items").toBeDefined();

    const agreeing = scoreInventory("big_five", { [reversed!.id]: 5 });
    const disagreeing = scoreInventory("big_five", { [reversed!.id]: 1 });

    const scaleOf = (result: ReturnType<typeof scoreInventory>) =>
      result.scales.find((scale) => scale.key === reversed!.scale)!;

    expect(scaleOf(agreeing).percent).toBe(0);
    expect(scaleOf(disagreeing).percent).toBe(100);
  });

  it("bands every answered scale and describes the band", () => {
    const result = scoreInventory("social_style", uniform("social_style", 5));
    for (const scale of result.scales) {
      expect(["low", "moderate", "high"]).toContain(scale.band);
      expect(scale.description.length).toBeGreaterThan(0);
    }
  });

  it("reports a scale with no answers rather than inventing a score", () => {
    const result = scoreInventory("big_five", {});
    expect(result.answered).toBe(0);
    for (const scale of result.scales) {
      expect(scale.percent).toBeNull();
      expect(scale.band).toBeNull();
    }
  });

  it("scores a partly answered inventory on the answers it has", () => {
    const inventory = inventoryById("behavioural_profile");
    const first = inventory.items[0];
    const result = scoreInventory("behavioural_profile", { [first.id]: 5 });

    expect(result.answered).toBe(1);
    const scored = result.scales.find((scale) => scale.key === first.scale)!;
    expect(scored.answered).toBe(1);
    expect(scored.percent).toBe(first.reverse ? 0 : 100);
  });

  it("rejects a response outside the scale rather than scoring it", () => {
    const inventory = inventoryById("big_five");
    expect(() =>
      scoreInventory("big_five", { [inventory.items[0].id]: 9 }),
    ).toThrow(/9/);
    expect(() =>
      scoreInventory("big_five", { [inventory.items[0].id]: 0 }),
    ).toThrow();
  });

  it("ignores a response to an item that is not in the inventory", () => {
    const withStray = scoreInventory("big_five", {
      ...uniform("big_five", 3),
      not_an_item: 5,
    });
    expect(withStray.answered).toBe(inventoryById("big_five").items.length);
  });
});

describe("catalogue wording is original", () => {
  /**
   * The published DISC and Enneagram instruments are licensed products; Big
   * Five items may be adapted from the public-domain IPIP pool. The catalogue
   * must not name a licensed instrument as though it were shipping it.
   */
  it("does not present itself as a published instrument", () => {
    const text = JSON.stringify(ASSESSMENT_CATALOGUE);
    expect(text).not.toMatch(/\bDISC\b/);
    expect(text).not.toMatch(/Myers|Briggs|MBTI|16PF|NEO-PI/i);
  });
});
