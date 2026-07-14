import { generateEmailCandidates } from "../candidates";

describe("candidates", () => {
  it("suppresses low-confidence guesses in default mode when no pattern is known", () => {
    // Cold-outreach hardening: with no found emails and an unknown pattern,
    // every generated candidate scores below the 0.4 default-mode threshold,
    // so the generator declines rather than emitting speculative addresses.
    const output = generateEmailCandidates({
      name: {
        first: "john",
        last: "smith",
        firstInitial: "j",
        tokens: ["john", "smith"],
        confidence: 1,
      },
      domain: "acme.com",
      domainConfidence: 1,
      pattern: {
        pattern: "unknown",
        confidence: 0,
        sample_count: 0,
      },
      foundEmails: [],
      mode: "default",
    });

    expect(output).toHaveLength(0);
  });

  it("generates a ranked candidate when a confident pattern is known", () => {
    const output = generateEmailCandidates({
      name: {
        first: "john",
        last: "smith",
        firstInitial: "j",
        tokens: ["john", "smith"],
        confidence: 1,
      },
      domain: "acme.com",
      domainConfidence: 1,
      pattern: {
        pattern: "first.last",
        confidence: 0.9,
        sample_count: 4,
      },
      foundEmails: [],
      mode: "default",
    });

    expect(output.length).toBeGreaterThanOrEqual(1);
    expect(output.length).toBeLessThanOrEqual(5);
    expect(output[0].email).toBe("john.smith@acme.com");
  });

  it("applies generic email penalty", () => {
    const output = generateEmailCandidates({
      name: {
        first: "info",
        last: "smith",
        firstInitial: "i",
        tokens: ["info", "smith"],
        confidence: 1,
      },
      domain: "acme.com",
      domainConfidence: 1,
      pattern: {
        pattern: "first",
        confidence: 0.9,
        sample_count: 3,
      },
      foundEmails: [],
      mode: "default",
    });

    const firstCandidate = output[0];
    expect(firstCandidate).toBeDefined();
    expect(firstCandidate.confidence).toBeLessThan(0.9);
  });
});
