import { defineTool } from "@lovable.dev/mcp-js";

export default defineTool({
  name: "list_sites",
  title: "List sites",
  description: "List all job sites with address, coordinates and geofence radius.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { getSites } = await import("../../sheets.server");
    const sites = await getSites();
    return {
      content: [{ type: "text", text: JSON.stringify(sites, null, 2) }],
      structuredContent: { sites },
    };
  },
});
