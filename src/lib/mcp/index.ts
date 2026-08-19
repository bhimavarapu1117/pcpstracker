import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listEmployees from "./tools/list-employees";
import listSites from "./tools/list-sites";
import getDailyReport from "./tools/get-daily-report";
import listOpenSessions from "./tools/list-open-sessions";

const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "popstracker",
  title: "POPSTracker",
  version: "0.1.0",
  instructions:
    "Read-only tools for the POPS Pest Care attendance tracker: employees, job sites with geofences, daily attendance/site-visit reports, and currently open logins or site visits.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listEmployees, listSites, getDailyReport, listOpenSessions] as unknown as Parameters<typeof defineMcp>[0]["tools"],
});
