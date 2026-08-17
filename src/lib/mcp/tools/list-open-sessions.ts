import { defineTool } from "@lovable.dev/mcp-js";

export default defineTool({
  name: "list_open_sessions",
  title: "List open logins and site visits",
  description:
    "List employees who are still logged in and site visits that have not been checked out.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { listOpenShifts, listOpenVisits } = await import("../../sheets.server");
    const [openLogins, openVisits] = await Promise.all([listOpenShifts(), listOpenVisits()]);
    const payload = { openLogins, openVisits };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
