/**
 * Google Sheets data layer (server-only).
 * Mirrors the original Apps Script sheet structure:
 * Employees | Sites | Attendance | SiteVisits | LocationLogs
 */

export const SPREADSHEET_ID = "1SPHz0CV2TObhhlSzhmG2NuUpSmU1duqIHlCd_tzEYRI";
export const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
export const DEFAULT_GEOFENCE_RADIUS = 100;

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";

function authHeaders() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const sheetsKey = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lovableKey || !sheetsKey) {
    throw new Error("Google Sheets connection is not configured.");
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": sheetsKey,
    "Content-Type": "application/json",
  };
}

async function gateway(path: string, init?: RequestInit) {
  let attempt = 0;
  // Sheets enforces a per-minute read quota; back off instead of hammering it.
  while (true) {
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      ...init,
      headers: authHeaders(),
    });
    if (res.ok) return res.json();
    const body = await res.text();
    if (res.status === 429 && attempt < 5) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      attempt += 1;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    console.error(`Sheets request failed [${res.status}]: ${body}`);
    throw new Error(`Google Sheets request failed [${res.status}]: ${body}`);
  }
}

/* ---------- read cache (quota protection) ---------- */

const READ_TTL_MS = 45_000;
type Entry = { at: number; inflight?: Promise<string[][]>; value?: string[][] };
const readCache = new Map<string, Entry>();

function invalidateReads() {
  // Keep last values as stale fallback, but force a refetch.
  for (const entry of readCache.values()) entry.at = 0;
}

export async function readRange(range: string): Promise<string[][]> {
  const entry = readCache.get(range);
  if (entry) {
    if (entry.inflight) return entry.inflight;
    if (entry.value && Date.now() - entry.at < READ_TTL_MS) return entry.value;
  }

  const inflight = gateway(`/spreadsheets/${SPREADSHEET_ID}/values/${range}`)
    .then((data) => {
      const value = (data.values as string[][]) ?? [];
      readCache.set(range, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      // Serve stale data rather than blanking the app on a quota error.
      const stale = readCache.get(range)?.value;
      if (stale) {
        readCache.set(range, { at: Date.now() - READ_TTL_MS + 5_000, value: stale });
        return stale;
      }
      readCache.delete(range);
      throw err;
    });

  readCache.set(range, { ...(entry ?? {}), at: entry?.at ?? 0, inflight });
  return inflight;
}

export async function appendRow(range: string, row: (string | number)[]) {
  await gateway(
    `/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row] }) },
  );
  invalidateReads();
}

export async function updateRange(range: string, values: (string | number)[][]) {
  await gateway(`/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
  invalidateReads();
}

/** Reads a range bypassing the cache (needed before updating an existing row). */
export async function readRangeFresh(range: string): Promise<string[][]> {
  const data = await gateway(`/spreadsheets/${SPREADSHEET_ID}/values/${range}`);
  const value = (data.values as string[][]) ?? [];
  readCache.set(range, { at: Date.now(), value });
  return value;
}





/* ---------- helpers ---------- */

export function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
}

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function timeLabel(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

/* ---------- IST date/time formatting (Attendance sheet) ---------- */

const IST = "Asia/Kolkata";

/** DD/MM/YYYY in IST */
export function istDate(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  return p;
}

/** hh:mm:ss AM/PM in IST */
export function istTime(d = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
}

/** Turns "17/08/2026" + "09:47:41 PM" (IST) back into an ISO timestamp. */
export function istToIso(date: string, time: string): string | null {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(date).trim());
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(String(time).trim());
  if (!d || !t) return null;
  let hour = Number(t[1]);
  const meridiem = t[4]?.toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = `${d[3]}-${d[2]}-${d[1]}T${pad(hour)}:${t[2]}:${t[3] ?? "00"}+05:30`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}


/* ---------- domain reads ---------- */

export type Employee = {
  employeeId: string;
  name: string;
  phone: string;
  email: string;
  active: boolean;
};

export type Site = {
  siteId: string;
  siteName: string;
  customer: string;
  address: string;
  latitude: number;
  longitude: number;
  radius: number;
};

export async function getEmployees(): Promise<(Employee & { pin: string })[]> {
  const rows = await readRange("Employees!A2:F1000");
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      employeeId: String(r[0]).trim(),
      name: String(r[1] ?? "").trim(),
      pin: String(r[2] ?? "").trim(),
      phone: String(r[3] ?? ""),
      email: String(r[4] ?? ""),
      active: String(r[5] ?? "").toLowerCase() === "true",
    }));
}

export async function getEmployeeName(employeeId: string) {
  const employees = await getEmployees();
  return employees.find((e) => e.employeeId === String(employeeId))?.name ?? "Unknown";
}

export async function getSites(): Promise<Site[]> {
  const rows = await readRange("Sites!A2:H1000");
  return rows
    .filter((r) => r[0] && String(r[7] ?? "").toLowerCase() === "true")
    .map((r) => ({
      siteId: String(r[0]),
      siteName: String(r[1] ?? ""),
      customer: String(r[2] ?? ""),
      address: String(r[3] ?? ""),
      latitude: Number(r[4]),
      longitude: Number(r[5]),
      radius: Number(r[6]) || DEFAULT_GEOFENCE_RADIUS,
    }));
}

/* ---------- writes ---------- */

export type GeoPayload = {
  employeeId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  notes?: string | undefined;
};

/**
 * Attendance sheet layout (one row per shift):
 * A Employee ID | B Employee Name | C Login Status | D Login Time | E Login Date
 * F Logout Status | G Logout Time | H Logout Date | I Google Maps | J Notes
 */
export const ATTENDANCE_RANGE = "Attendance!A2:J2000";

export type Shift = {
  employeeId: string;
  employeeName: string;
  loginIso: string | null;
  logoutIso: string | null;
  mapLink: string;
  notes: string;
};

export function parseShifts(rows: string[][]): Shift[] {
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      employeeId: String(r[0]).trim(),
      employeeName: String(r[1] ?? ""),
      loginIso: istToIso(String(r[4] ?? ""), String(r[3] ?? "")),
      logoutIso: istToIso(String(r[7] ?? ""), String(r[6] ?? "")),
      mapLink: String(r[8] ?? ""),
      notes: String(r[9] ?? ""),
    }));
}

export async function writeAttendance(data: GeoPayload & { action: string }) {
  const name = await getEmployeeName(data.employeeId);
  const now = new Date();
  const link = mapsLink(data.latitude, data.longitude);

  if (data.action === "CHECK_IN") {
    await appendRow("Attendance!A:J", [
      data.employeeId,
      name,
      "LOGGED IN",
      istTime(now),
      istDate(now),
      "",
      "",
      "",
      link,
      data.notes ?? "",
    ]);
    return { success: true, mapLink: link, employeeName: name };
  }

  // CHECK_OUT: close the last open row for this employee.
  const rows = await readRangeFresh(ATTENDANCE_RANGE);
  let target = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i] ?? [];
    if (String(r[0] ?? "").trim() === data.employeeId && !String(r[5] ?? "").trim()) {
      target = i;
      break;
    }
  }

  if (target === -1) {
    await appendRow("Attendance!A:J", [
      data.employeeId,
      name,
      "",
      "",
      "",
      "LOGGED OUT",
      istTime(now),
      istDate(now),
      link,
      data.notes ?? "",
    ]);
  } else {
    const sheetRow = target + 2; // data starts at row 2
    await updateRange(`Attendance!F${sheetRow}:J${sheetRow}`, [
      ["LOGGED OUT", istTime(now), istDate(now), link, data.notes ?? ""],
    ]);
  }

  return { success: true, mapLink: link, employeeName: name };
}


export async function writeSiteVisit(data: GeoPayload & { action: string; siteId: string }) {
  const [name, sites] = await Promise.all([getEmployeeName(data.employeeId), getSites()]);
  const site = sites.find((s) => s.siteId === String(data.siteId));
  if (!site) throw new Error("Site not found.");

  const distance = distanceMeters(data.latitude, data.longitude, site.latitude, site.longitude);
  const withinGeofence = distance <= site.radius;
  const now = new Date();
  const link = mapsLink(data.latitude, data.longitude);

  await appendRow("SiteVisits!A:O", [
    now.toISOString(),
    isoDate(now),
    data.employeeId,
    name,
    site.siteId,
    site.siteName,
    site.customer,
    data.action,
    data.latitude,
    data.longitude,
    data.accuracy,
    Math.round(distance),
    withinGeofence ? "YES" : "NO",
    link,
    data.notes ?? "",
  ]);

  return {
    success: true,
    withinGeofence,
    distance: Math.round(distance),
    mapLink: link,
    siteName: site.siteName,
  };
}

export async function writeLocation(data: GeoPayload) {
  const name = await getEmployeeName(data.employeeId);
  const now = new Date();
  await appendRow("LocationLogs!A:H", [
    now.toISOString(),
    isoDate(now),
    data.employeeId,
    name,
    data.latitude,
    data.longitude,
    data.accuracy,
    mapsLink(data.latitude, data.longitude),
  ]);
  return { success: true };
}

/* ---------- today status (live timer) ---------- */

export type DayEvent = {
  timestamp: string;
  type: "CHECK_IN" | "CHECK_OUT" | "SITE_CHECK_IN" | "SITE_CHECK_OUT";
  label: string;
  mapLink: string;
  distance?: number;
  withinGeofence?: boolean;
  notes?: string;
};

export async function readTodayForEmployee(employeeId: string) {
  const date = isoDate();
  const [attendanceRows, visitRows] = await Promise.all([
    readRange("Attendance!A2:J2000"),
    readRange("SiteVisits!A2:O2000"),
  ]);

  const mine = attendanceRows
    .filter((r) => r[1] === date && String(r[2]) === employeeId)
    .map((r) => ({
      timestamp: String(r[0]),
      action: String(r[4]),
      mapLink: String(r[8] ?? ""),
      notes: String(r[9] ?? ""),
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const myVisits = visitRows
    .filter((r) => r[1] === date && String(r[2]) === employeeId)
    .map((r) => ({
      timestamp: String(r[0]),
      siteId: String(r[4]),
      siteName: String(r[5]),
      action: String(r[7]),
      distance: Number(r[11]) || 0,
      withinGeofence: String(r[12]) === "YES",
      mapLink: String(r[13] ?? ""),
      notes: String(r[14] ?? ""),
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let openShiftStart: string | null = null;
  let completedSeconds = 0;
  for (const row of mine) {
    if (row.action === "CHECK_IN") {
      openShiftStart = row.timestamp;
    } else if (row.action === "CHECK_OUT" && openShiftStart) {
      completedSeconds += Math.max(
        0,
        (new Date(row.timestamp).getTime() - new Date(openShiftStart).getTime()) / 1000,
      );
      openShiftStart = null;
    }
  }

  let openVisit: { siteId: string; siteName: string; startedAt: string } | null = null;
  for (const v of myVisits) {
    if (v.action === "SITE_CHECK_IN") {
      openVisit = { siteId: v.siteId, siteName: v.siteName, startedAt: v.timestamp };
    } else if (v.action === "SITE_CHECK_OUT") {
      openVisit = null;
    }
  }

  const events: DayEvent[] = [
    ...mine.map((r) => ({
      timestamp: r.timestamp,
      type: r.action as DayEvent["type"],
      label: r.action === "CHECK_IN" ? "Logged in" : "Logged out",
      mapLink: r.mapLink,
      notes: r.notes,
    })),
    ...myVisits.map((v) => ({
      timestamp: v.timestamp,
      type: v.action as DayEvent["type"],
      label: `${v.siteName} — ${v.action === "SITE_CHECK_IN" ? "site in" : "site out"}`,
      mapLink: v.mapLink,
      distance: v.distance,
      withinGeofence: v.withinGeofence,
      notes: v.notes,
    })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    date,
    serverNow: new Date().toISOString(),
    openShiftStart,
    completedSeconds: Math.round(completedSeconds),
    openVisit,
    events,
  };
}

/* ---------- admin dashboard ---------- */

export type AdminData = Awaited<ReturnType<typeof buildAdminData>>;


export async function buildAdminData(date: string) {
  const [employees, sites, attendanceRows, visitRows, locationRows] = await Promise.all([
    getEmployees(),
    getSites(),
    readRange("Attendance!A2:J2000"),
    readRange("SiteVisits!A2:O2000"),
    readRange("LocationLogs!A2:H2000"),
  ]);

  const attendance = attendanceRows
    .filter((r) => r[1] === date)
    .map((r) => ({
      timestamp: String(r[0]),
      employeeId: String(r[2]),
      employeeName: String(r[3]),
      action: String(r[4]),
      accuracy: Number(r[7]) || 0,
      mapLink: String(r[8] ?? ""),
      notes: String(r[9] ?? ""),
    }));

  const visits = visitRows
    .filter((r) => r[1] === date)
    .map((r) => ({
      timestamp: String(r[0]),
      employeeId: String(r[2]),
      employeeName: String(r[3]),
      siteName: String(r[5]),
      customer: String(r[6]),
      action: String(r[7]),
      accuracy: Number(r[10]) || 0,
      distance: Number(r[11]) || 0,
      withinGeofence: String(r[12]) === "YES",
      mapLink: String(r[13] ?? ""),
    }));

  const locations = locationRows
    .filter((r) => r[1] === date)
    .map((r) => ({
      timestamp: String(r[0]),
      employeeId: String(r[2]),
      employeeName: String(r[3]),
      latitude: Number(r[4]),
      longitude: Number(r[5]),
      accuracy: Number(r[6]) || 0,
      mapLink: String(r[7] ?? ""),
    }))
    .reverse();

  const roster = employees
    .filter((e) => e.active)
    .map((e) => {
      const own = attendance
        .filter((a) => a.employeeId === e.employeeId)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const checkIn = own.find((a) => a.action === "CHECK_IN");
      const checkOut = [...own].reverse().find((a) => a.action === "CHECK_OUT");

      let openSince: string | null = null;
      let completedSeconds = 0;
      for (const row of own) {
        if (row.action === "CHECK_IN") openSince = row.timestamp;
        else if (row.action === "CHECK_OUT" && openSince) {
          completedSeconds += Math.max(
            0,
            (new Date(row.timestamp).getTime() - new Date(openSince).getTime()) / 1000,
          );
          openSince = null;
        }
      }

      return {
        employeeId: e.employeeId,
        name: e.name,
        phone: e.phone,
        checkIn: checkIn ? timeLabel(checkIn.timestamp) : "",
        checkOut: checkOut ? timeLabel(checkOut.timestamp) : "",
        openSince,
        completedSeconds: Math.round(completedSeconds),
        visits: visits.filter(
          (v) => v.employeeId === e.employeeId && v.action === "SITE_CHECK_IN",
        ).length,
        lastSeen: locations.find((l) => l.employeeId === e.employeeId) ?? null,
      };
    });

  return {
    date,
    serverNow: new Date().toISOString(),
    spreadsheetUrl: SPREADSHEET_URL,
    roster,
    sites,
    attendance: [...attendance].reverse(),
    visits: [...visits].reverse(),
    locations: locations.slice(0, 200),
    totals: {
      present: roster.filter((r) => r.checkIn).length,
      employees: roster.length,
      stillIn: roster.filter((r) => r.openSince).length,
      hours:
        Math.round(
          (roster.reduce(
            (sum, r) =>
              sum +
              r.completedSeconds +
              (r.openSince ? (Date.now() - new Date(r.openSince).getTime()) / 1000 : 0),
            0,
          ) /
            3600) *
            10,
        ) / 10,
      visits: visits.filter((v) => v.action === "SITE_CHECK_IN").length,
      outsideGeofence: visits.filter((v) => !v.withinGeofence).length,
    },
  };
}


export function renderDailyReportHtml(data: AdminData) {
  const rows = data.roster
    .map(
      (r) => `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${r.name}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${r.checkIn || "-"}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${r.checkOut || "-"}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${r.visits}</td>
      </tr>`,
    )
    .join("");

  return `<div style="font-family:Arial,sans-serif;color:#111827">
    <h2>Daily Field Attendance Report</h2>
    <p><strong>Date:</strong> ${data.date}</p>
    <table style="border-collapse:collapse;width:100%;max-width:640px">
      <thead><tr style="background:#f3f4f6">
        <th align="left" style="padding:8px">Employee</th>
        <th align="left" style="padding:8px">Check In</th>
        <th align="left" style="padding:8px">Check Out</th>
        <th align="left" style="padding:8px">Site Visits</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3>Summary</h3>
    <p>Employees present: ${data.totals.present} / ${data.totals.employees}<br/>
    Total site visits: ${data.totals.visits}<br/>
    Visits outside geofence: ${data.totals.outsideGeofence}</p>
    <p><a href="${data.spreadsheetUrl}">Open the Google Sheet</a> for full GPS history and Maps links.</p>
  </div>`;
}
