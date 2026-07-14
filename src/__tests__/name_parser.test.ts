import { parsePersonName } from "../name_parser";

describe("name_parser", () => {
  it("normalizes diacritics and suffixes", () => {
    const parsed = parsePersonName("Dr. María José García-López III");
    expect(parsed.first).toBe("maria");
    expect(parsed.last).toBe("garcia-lopez");
    expect(parsed.firstInitial).toBe("m");
    expect(parsed.tokens).toEqual(["maria", "jose", "garcia", "lopez"]);
  });

  it("handles single-token names without duplicating last name", () => {
    const parsed = parsePersonName("Madonna");
    expect(parsed.first).toBe("madonna");
    expect(parsed.last).toBe("");
  });
});
