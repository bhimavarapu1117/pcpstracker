import { defineTool } from "@lovable.dev/mcp-js";

export default defineTool({
  name: "list_employees",
  title: "List employees",
  description: "List all employees (ID and name) registered in the attendance tracker.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { getEmployees } = await import("../../sheets.server");
    const employees = (await getEmployees()).map((e) => ({ id: e.employeeId, name: e.name }));
    return {
      content: [{ type: "text", text: JSON.stringify(employees, null, 2) }],
      structuredContent: { employees },
    };
  },
});
