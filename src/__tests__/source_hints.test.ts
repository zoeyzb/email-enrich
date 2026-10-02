import { harvestPublicSourceUrls } from "../harvest";
import { orchestrate } from "../index";

const makeResponse = (url: string, html: string) => ({
  ok: true,
  url,
  headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null },
  text: async () => html,
});

describe("public source URL hints", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("harvests published emails from exact safe public source URLs", async () => {
    const fetchMock = jest.spyOn(global, "fetch" as never).mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input);
      return makeResponse(url, "<html><body>Jane Doe — jane.doe@gmail.com</body></html>") as unknown as Response;
    }) as typeof fetch);

    const result = await harvestPublicSourceUrls({
      source_urls: [
        "https://bar.example.org/profile/jane-doe",
        "http://127.0.0.1/private",
      ],
    });

    expect(result.emails).toEqual(["jane.doe@gmail.com"]);
    expect(result.sources_checked).toEqual(["https://bar.example.org/profile/jane-doe"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("returns a real hinted email without requiring a company website or domain", async () => {
    jest.spyOn(global, "fetch" as never).mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input);
      return makeResponse(
        url,
        "<html><body><h1>Jane Doe</h1><p>Email: jane.doe@gmail.com</p></body></html>"
      ) as unknown as Response;
    }) as typeof fetch);

    const result = await orchestrate("law-pipeline-source-hint-test", {
      person_name: "Jane Doe",
      company_name: "Doe Legal Group",
      hints: { source_urls: ["https://bar.example.org/profile/jane-doe"] },
      mode: "fast",
      real_only: true,
      use_case: "cold_outreach",
    });

    expect(result.status).toBe("ok");
    expect(result.best_email).toBe("jane.doe@gmail.com");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.evidence.sources_checked).toContain("https://bar.example.org/profile/jane-doe");
    expect(result.evidence.found_public_emails).toContain("jane.doe@gmail.com");
  });
});
