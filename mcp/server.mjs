#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { harvestPublicEmails, orchestrate } from "../dist/index.js";

const server = new Server(
  { name: "email-enrich", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "email_enrich_find",
      description:
        "Find a professional email using public company pages, inferred patterns and optional SMTP verification. No paid enrichment API is required.",
      inputSchema: {
        type: "object",
        properties: {
          person_name: { type: "string" },
          company_name: { type: "string" },
          company_domain: { type: "string" },
          company_website: { type: "string" },
          role: { type: "string" },
          source_urls: { type: "array", items: { type: "string" } },
          mode: { type: "string", enum: ["default", "strict", "fast"], default: "default" },
          real_only: { type: "boolean", default: false },
          use_case: {
            type: "string",
            enum: ["general", "ai_research", "vc", "sales", "cold_outreach"],
            default: "cold_outreach"
          }
        },
        required: ["person_name", "company_name"]
      }
    },
    {
      name: "email_enrich_harvest_domain",
      description:
        "Harvest email addresses already published on a company's public website. This does not guess addresses or use a paid data provider.",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string" },
          mode: { type: "string", enum: ["default", "strict", "fast"], default: "default" }
        },
        required: ["domain"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = request.params.arguments ?? {};
    let result;

    if (request.params.name === "email_enrich_find") {
      result = await orchestrate("chatgpt-mcp", {
        person_name: args.person_name,
        company_name: args.company_name,
        company_domain: args.company_domain ?? "",
        company_website: args.company_website ?? "",
        hints: {
          role: args.role,
          source_urls: Array.isArray(args.source_urls) ? args.source_urls : []
        },
        mode: args.mode ?? "default",
        real_only: args.real_only ?? false,
        use_case: args.use_case ?? "cold_outreach"
      });
    } else if (request.params.name === "email_enrich_harvest_domain") {
      result = await harvestPublicEmails({
        domain: String(args.domain ?? ""),
        mode: args.mode ?? "default"
      });
    } else {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
