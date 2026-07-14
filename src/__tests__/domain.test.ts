const mockResolve4 = jest.fn();
const mockResolve6 = jest.fn();

jest.mock("dns", () => ({
  promises: {
    resolve4: (...args: any[]) => mockResolve4(...args),
    resolve6: (...args: any[]) => mockResolve6(...args),
  },
}));

import { resolveCompanyDomain } from "../domain";

describe("domain", () => {
  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
  });

  it("uses provided company_domain first", async () => {
    const result = await resolveCompanyDomain({
      company_name: "Acme Corp",
      company_domain: "acme.com",
      company_website: "",
    });

    expect(result?.domain).toBe("acme.com");
    expect(result?.method).toBe("provided_domain");
  });

  it("does not guess domain from company name by default", async () => {
    mockResolve4.mockResolvedValue(["1.2.3.4"]);
    const result = await resolveCompanyDomain({
      company_name: "Acme",
      company_domain: "",
      company_website: "",
    });
    expect(result).toBeNull();
  });
});
