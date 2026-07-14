const mockResolveCompanyDomain = jest.fn();
const mockHarvestPublicEmails = jest.fn();
const mockVerifyEmailViaSmtp = jest.fn();
const mockCollectTeamSignals = jest.fn();

jest.mock("../domain", () => ({
  resolveCompanyDomain: (...args: any[]) => mockResolveCompanyDomain(...args),
}));

jest.mock("../harvest", () => ({
  harvestPublicEmails: (...args: any[]) => mockHarvestPublicEmails(...args),
}));

jest.mock("../verify_smtp", () => ({
  verifyEmailViaSmtp: (...args: any[]) => mockVerifyEmailViaSmtp(...args),
}));

jest.mock("../team_signals", () => ({
  collectTeamSignals: (...args: any[]) => mockCollectTeamSignals(...args),
}));

import { orchestrate } from "..";

describe("orchestrator", () => {
  beforeEach(() => {
    mockResolveCompanyDomain.mockReset();
    mockHarvestPublicEmails.mockReset();
    mockVerifyEmailViaSmtp.mockReset();
    mockCollectTeamSignals.mockReset();
    mockCollectTeamSignals.mockResolvedValue({
      sources_checked: [],
      founder_mentioned: false,
    });
  });

  it("returns ok with best candidate", async () => {
    mockResolveCompanyDomain.mockResolvedValue({
      domain: "acme.com",
      confidence: 1,
      method: "provided_domain",
    });
    mockHarvestPublicEmails.mockResolvedValue({
      emails: ["john.smith@acme.com", "jane.doe@acme.com"],
      sources_checked: ["https://acme.com/team"],
      pages_fetched: 1,
    });
    mockVerifyEmailViaSmtp.mockResolvedValue({ method: "smtp_probe", result: "valid" });

    const result = await orchestrate("user-1", {
      person_name: "John Smith",
      company_name: "Acme Corp",
      company_domain: "acme.com",
      mode: "default",
    });

    expect(result.status).toBe("ok");
    expect(result.best_email).toBe("john.smith@acme.com");
  });

  it("returns needs_user_input when domain cannot be resolved", async () => {
    mockResolveCompanyDomain.mockResolvedValue(null);
    const result = await orchestrate("user-1", {
      person_name: "John Smith",
      company_name: "Unknown Co",
      mode: "strict",
    });
    expect(result.status).toBe("needs_user_input");
  });

  it("skips team signal fetch in real_only mode", async () => {
    mockResolveCompanyDomain.mockResolvedValue({
      domain: "realonly.example",
      confidence: 1,
      method: "provided_domain",
    });
    mockHarvestPublicEmails.mockResolvedValue({
      emails: ["founder@realonly.example"],
      sources_checked: ["https://realonly.example/team"],
      pages_fetched: 1,
    });

    const result = await orchestrate("user-realonly", {
      person_name: "Founder Name",
      company_name: "RealOnly Inc",
      company_domain: "realonly.example",
      mode: "default",
      real_only: true,
    });

    expect(result.status).toBe("ok");
    expect(mockCollectTeamSignals).not.toHaveBeenCalled();
  });

  it("does not return a colleague's harvested email as best_email for the requested person", async () => {
    mockResolveCompanyDomain.mockResolvedValue({
      domain: "acme.com",
      confidence: 1,
      method: "provided_domain",
    });
    mockHarvestPublicEmails.mockResolvedValue({
      emails: ["jane.doe@acme.com"],
      sources_checked: ["https://acme.com/team"],
      pages_fetched: 1,
    });
    mockVerifyEmailViaSmtp.mockResolvedValue({ method: "smtp_probe", result: "unknown" });

    const result = await orchestrate("user-colleague", {
      person_name: "John Smith",
      company_name: "Acme Corp",
      company_domain: "acme.com",
      mode: "default",
    });

    expect(result.best_email).not.toBe("jane.doe@acme.com");
    expect(result.candidates.map((c) => c.email)).not.toContain("jane.doe@acme.com");
    // The colleague email still surfaces as evidence, just not as a candidate.
    expect(result.evidence.found_public_emails).toContain("jane.doe@acme.com");
  });

  it("falls back to pattern-generated candidates when harvested emails belong to colleagues", async () => {
    mockResolveCompanyDomain.mockResolvedValue({
      domain: "acme.com",
      confidence: 1,
      method: "provided_domain",
    });
    mockHarvestPublicEmails.mockResolvedValue({
      emails: ["jane.doe@acme.com", "bob.jones@acme.com"],
      sources_checked: ["https://acme.com/team"],
      pages_fetched: 1,
    });
    mockVerifyEmailViaSmtp.mockResolvedValue({ method: "smtp_probe", result: "unknown" });

    const result = await orchestrate("user-fallback", {
      person_name: "John Smith",
      company_name: "Acme Corp",
      company_domain: "acme.com",
      mode: "default",
    });

    expect(result.status).toBe("ok");
    expect(result.best_email).toBe("john.smith@acme.com");
    expect(result.candidates.map((c) => c.email)).not.toContain("jane.doe@acme.com");
    expect(result.candidates.map((c) => c.email)).not.toContain("bob.jones@acme.com");
  });

  it("returns not_found when SMTP marks pattern-generated candidates invalid", async () => {
    mockResolveCompanyDomain.mockResolvedValue({
      domain: "smtpinvalid.example",
      confidence: 1,
      method: "provided_domain",
    });
    // Colleague emails establish a first.last pattern but don't match "John Smith",
    // so no harvested address is returned directly; the orchestrator falls back to
    // generating john.smith@... and then verifies it over SMTP.
    mockHarvestPublicEmails.mockResolvedValue({
      emails: ["alice.wong@smtpinvalid.example", "carol.reed@smtpinvalid.example"],
      sources_checked: ["https://smtpinvalid.example/team"],
      pages_fetched: 1,
    });
    mockVerifyEmailViaSmtp.mockResolvedValue({ method: "smtp_probe", result: "invalid" });

    const result = await orchestrate("user-invalid", {
      person_name: "John Smith",
      company_name: "SMTP Invalid Inc",
      company_domain: "smtpinvalid.example",
      mode: "default",
    });

    expect(mockVerifyEmailViaSmtp).toHaveBeenCalledWith("john.smith@smtpinvalid.example");
    expect(result.status).toBe("not_found");
    expect(result.candidates).toHaveLength(0);
  });
});
