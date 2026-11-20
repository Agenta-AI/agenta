import { describe, expect, it } from "vitest";

import { formatStars } from "./githubStars";

describe("formatStars", () => {
  it("rounds down to one decimal in thousands", () => {
    expect(formatStars(4906)).toBe("4.9k");
    expect(formatStars(4999)).toBe("4.9k");
    expect(formatStars(12345)).toBe("12.3k");
    expect(formatStars(1000)).toBe("1.0k");
  });
  it("shows small counts as is", () => {
    expect(formatStars(950)).toBe("950");
  });
});
