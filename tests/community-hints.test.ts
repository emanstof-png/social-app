import { describe, expect, it } from "vitest";

import { communityHint } from "../lib/settings/community-hints";

describe("communityHint", () => {
  it("returns null with fewer than two recent visits", () => {
    expect(communityHint([])).toBeNull();
    expect(communityHint([true])).toBeNull();
  });

  it("counts liked out of total once there are at least two", () => {
    expect(communityHint([true, false])).toEqual({ liked: 1, total: 2 });
    expect(communityHint([true, true, true, false, false])).toEqual({ liked: 3, total: 5 });
  });
});
