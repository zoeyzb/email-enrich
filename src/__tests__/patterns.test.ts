import { inferEmailPattern } from "../patterns";

describe("patterns", () => {
  it("infers first.last pattern", () => {
    const result = inferEmailPattern({
      domain: "acme.com",
      emails: [
        "john.smith@acme.com",
        "jane.doe@acme.com",
        "info@acme.com",
      ],
    });

    expect(result.pattern).toBe("first.last");
    expect(result.confidence).toBeGreaterThan(0.6);
  });
});
