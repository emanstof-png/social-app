import { describe, expect, it } from "vitest";

import { buildEvaluationPrompt } from "../lib/push/notification";

describe("buildEvaluationPrompt", () => {
  it("names the event and the community, and links to /evaluations", () => {
    const payload = buildEvaluationPrompt({
      eventTitle: "Contra Dance",
      communityName: "Friends of Silver Spring",
    });

    expect(payload.title).toContain("Contra Dance");
    expect(payload.body).toContain("Friends of Silver Spring");
    expect(payload.url).toBe("/evaluations");
  });
});
