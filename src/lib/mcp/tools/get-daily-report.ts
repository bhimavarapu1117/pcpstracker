import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "get_daily_report",
  title: "Get daily attendance report",
  description:
    "Get attendance logins/logouts and site visits for a given date (YYYY-MM-DD). Defaults to today.",
  inputSchema: {
    date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { buildAdminData, isoDate } = await import("../../sheets.server");
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : isoDate();
    const data = await buildAdminData(day);
    return {
      content: [{ type: "text", text: JSON.stringify({ ...data, date: day }, null, 2) }],
      structuredContent: { date: day, report: data },
    };
  },
});
