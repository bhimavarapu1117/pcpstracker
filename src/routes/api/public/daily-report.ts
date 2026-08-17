import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily report endpoint — call it from a scheduler (cron) once a day.
 * GET /api/public/daily-report?token=<ADMIN_PASSCODE>&date=YYYY-MM-DD
 */
export const Route = createFileRoute("/api/public/daily-report")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const expected = process.env["ADMIN_PASSCODE"] ?? "2468";
        if (url.searchParams.get("token") !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { buildAdminData, renderDailyReportHtml, isoDate } = await import(
          "@/lib/sheets.server"
        );
        const date = url.searchParams.get("date") || isoDate();
        const data = await buildAdminData(date);

        return new Response(renderDailyReportHtml(data), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  },
});
