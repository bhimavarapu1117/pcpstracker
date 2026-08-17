# Jibble-style tracker with live running timer

Rework the employee screen and admin dashboard to feel like Jibble's attendance tracker, and add a live-running clock that starts on check-in and stops on check-out.

## Employee screen (Jibble-style)

- Big central "clock" card: current time, today's date, and a large running duration (HH:MM:SS) that ticks every second while the day is open.
- One primary action button that toggles state: **Clock In** -> (running) **Clock Out**. Same toggle pattern for site visits (Site Check-in -> Site Check-out on the selected site).
- Status pill: "Working since 09:12" / "Not clocked in", plus today's total worked time after clock-out.
- Timeline strip under the clock showing today's events (clock in, site in/out, clock out) with times, geofence badge, and Google Maps links.
- GPS panel condensed into a compact line (accuracy chip + refresh), tracking toggle kept.
- Session persists across page reloads (stored locally) so the timer resumes correctly.

## Timer behaviour

- On sign-in, the app asks the server for today's open state (last CHECK_IN without CHECK_OUT, and any open site visit) and starts the timer from that server timestamp — no drift, works after refresh.
- Timer ticks client-side each second; stops and freezes at the total when Clock Out is recorded.
- Separate secondary timer for the active site visit while one is open.

## Admin dashboard

- Jibble-like layout: date picker, summary tiles (present today, still clocked in, total hours, site visits, geofence breaches).
- "Who's in" live list: employee, clock-in time, running duration (ticks live for still-open days), last known location link.
- Per-employee day rows expandable to their timeline (day + site events) and location history points.
- Keep existing passcode gate, sheet link, and daily report.

## Technical notes

- New server function `getTodayStatus({ employeeId })` in `src/lib/attendance.functions.ts`, backed by a `readTodayForEmployee` helper in `src/lib/sheets.server.ts` that scans Attendance and SiteVisits rows for today and returns open check-in / open site visit timestamps.
- `buildAdminData` extended to include per-employee open-shift start time so the admin list can run live timers.
- Timer implemented as a small `useElapsed(startIso, running)` hook; all UI work stays in `src/routes/index.tsx`, `src/routes/admin.tsx`, and a couple of new components.
- No schema change to the Google Sheet; existing columns are enough.
