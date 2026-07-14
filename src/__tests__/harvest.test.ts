import { __private__ } from "../harvest";

describe("harvest helpers", () => {
  it("extracts deobfuscated and mailto emails", () => {
    const html = `
      <p>john [at] acme [dot] com</p>
      <a href="mailto:jane.doe@acme.com">Jane</a>
      <p>noreply@acme.com</p>
    `;
    const emails = __private__.extractEmailsFromHtml(html);
    expect(emails).toContain("john@acme.com");
    expect(emails).toContain("jane.doe@acme.com");
    expect(emails).not.toContain("noreply@acme.com");
  });
});
