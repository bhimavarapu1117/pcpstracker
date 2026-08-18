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
  const maxAttempts = 5;
  // Sheets enforces a per-minute read quota, and the gateway can drop connections
  // transiently (502/503/504). Back off and retry instead of failing the request.
  while (true) {
    let res: Response;
    try {
      res = await fetch(`${GATEWAY_URL}${path}`, {
        ...init,
        headers: authHeaders(),
      });
    } catch (err) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        attempt += 1;
        continue;
      }
      throw err;
    }
    if (res.ok) return res.json();
    const body = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
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

export function invalidateReads() {
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
    `/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row] }) },
  );
  invalidateReads();
}

export async function updateRange(range: string, values: (string | number)[][]) {
  await gateway(`/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=RAW`, {
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
  if (!d) return null;
  const raw = String(time).trim();
  const pad = (n: number) => String(n).padStart(2, "0");

  let hh: string, mm: string, ss: string;
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(raw);
  if (t) {
    let hour = Number(t[1]);
    const meridiem = t[4]?.toUpperCase();
    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    hh = pad(hour);
    mm = t[2]!;
    ss = t[3] ?? "00";
  } else if (/^\d*\.?\d+$/.test(raw)) {
    // Sheets stored the time as a day fraction (serial number).
    const total = Math.round(Number(raw) * 86400);
    hh = pad(Math.floor(total / 3600) % 24);
    mm = pad(Math.floor(total / 60) % 60);
    ss = pad(total % 60);
  } else {
    return null;
  }

  const iso = `${d[3]}-${d[2]}-${d[1]}T${hh}:${mm}:${ss}+05:30`;
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

/* ---------- Sites: address -> latitude/longitude/Maps sync ---------- */

const MAPS_GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

async function geocodeAddress(address: string) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const mapsKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovableKey || !mapsKey) throw new Error("Google Maps connection is not configured.");

  const res = await fetch(
    `${MAPS_GATEWAY}/maps/api/geocode/json?address=${encodeURIComponent(address)}`,
    {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": mapsKey,
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Geocoding failed [${res.status}]: ${body}`);
  }
  const data = (await res.json()) as {
    status?: string;
    results?: { geometry?: { location?: { lat: number; lng: number } } }[];
  };
  const loc = data.results?.[0]?.geometry?.location;
  if (!loc) return null;
  return { latitude: loc.lat, longitude: loc.lng };
}

/**
 * Sites sheet: column D (Address) is the source of truth.
 * Whenever an address is new or edited, latitude (E), longitude (F) and the
 * Google Maps link (I, an ARRAYFORMULA over the coordinates) are refreshed
 * automatically. Column J stores the address that was last geocoded.
 */
export async function syncSiteGeocodes(limit = 30) {
  const rows = await readRangeFresh("Sites!A2:J1000");
  let updated = 0;

  for (let i = 0; i < rows.length && updated < limit; i++) {
    const r = rows[i] ?? [];
    if (!String(r[0] ?? "").trim()) continue;

    const address = String(r[3] ?? "").trim();
    if (!address) continue;

    const lat = Number(r[4]);
    const lng = Number(r[5]);
    const lastGeocoded = String(r[9] ?? "").trim();
    const coordsMissing = !Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng);
    if (!coordsMissing && lastGeocoded === address) continue;

    try {
      const hit = await geocodeAddress(address);
      if (!hit) continue;
      const sheetRow = i + 2;
      await updateRange(`Sites!E${sheetRow}:F${sheetRow}`, [[hit.latitude, hit.longitude]]);
      await updateRange(`Sites!J${sheetRow}:J${sheetRow}`, [[address]]);
      updated += 1;
    } catch (err) {
      console.error(`Geocode sync failed for row ${i + 2}`, err);
    }
  }

  if (updated) invalidateReads();
  return { updated };
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

export const ATTENDANCE_HEADERS = [
  "Employee ID",
  "Employee Name",
  "Login Status",
  "Time",
  "Date",
  "Logout Status",
  "Time",
  "Date",
  "Google Maps",
  "Notes",
];

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
    // Don't open a second shift while one is still running.
    const existing = await readRangeFresh(ATTENDANCE_RANGE);
    const alreadyOpen = existing.some(
      (r) =>
        String(r[0] ?? "").trim() === data.employeeId &&
        String(r[2] ?? "").trim() &&
        !String(r[5] ?? "").trim(),
    );
    if (alreadyOpen) {
      return { success: true, mapLink: link, employeeName: name };
    }
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
    await updateRange(`Attendance!F${sheetRow}:H${sheetRow}`, [
      ["LOGGED OUT", istTime(now), istDate(now)],
    ]);
    await updateRange(`Attendance!I${sheetRow}:J${sheetRow}`, [[link, data.notes ?? ""]]);
  }

  return { success: true, mapLink: link, employeeName: name };
}

export async function listOpenShifts() {
  const rows = await readRangeFresh(ATTENDANCE_RANGE);
  return rows
    .map((r, i) => ({ r: r ?? [], sheetRow: i + 2 }))
    .filter(
      ({ r }) => String(r[0] ?? "").trim() && String(r[2] ?? "").trim() && !String(r[5] ?? "").trim(),
    )
    .map(({ r, sheetRow }) => ({
      sheetRow,
      employeeId: String(r[0]).trim(),
      employeeName: String(r[1] ?? ""),
      inIso: istToIso(String(r[4] ?? ""), String(r[3] ?? "")),
    }));
}

/** Admin force-closes an open shift row; logout is marked as done by admin. */
export async function forceCloseShift(sheetRow: number, notes?: string) {
  const rows = await readRangeFresh(ATTENDANCE_RANGE);
  const row = rows[sheetRow - 2];
  if (!row || !String(row[0] ?? "").trim()) throw new Error("Shift row not found.");
  if (String(row[5] ?? "").trim()) throw new Error("This shift is already logged out.");

  const now = new Date();
  await updateRange(`Attendance!F${sheetRow}:H${sheetRow}`, [
    ["LOGGED OUT BY ADMIN", istTime(now), istDate(now)],
  ]);
  await updateRange(`Attendance!J${sheetRow}`, [
    [notes || "Logged out by admin (employee did not log out)"],
  ]);
  return {
    success: true as const,
    employeeId: String(row[0]).trim(),
    employeeName: String(row[1] ?? ""),
  };
}





/**
 * SiteVisits sheet layout (one row per visit):
 * A Employee ID | B Employee Name | C Site ID | D Site Name
 * E Check-in Status | F Check-in Time | G Check-in Date | H Check-in Geofence | I Check-in Distance (m) | J Check-in Maps
 * K Check-out Status | L Check-out Time | M Check-out Date | N Check-out Geofence | O Check-out Distance (m) | P Check-out Maps
 * Q Notes
 */
export const SITEVISITS_RANGE = "SiteVisits!A2:Q2000";

export const SITEVISITS_HEADERS = [
  "Employee ID",
  "Employee Name",
  "Site ID",
  "Site Name",
  "Check-in Status",
  "Check-in Time",
  "Check-in Date",
  "Check-in Geofence",
  "Check-in Distance (m)",
  "Check-in Google Maps",
  "Check-out Status",
  "Check-out Time",
  "Check-out Date",
  "Check-out Geofence",
  "Check-out Distance (m)",
  "Check-out Google Maps",
  "Notes",
];

export type Visit = {
  employeeId: string;
  employeeName: string;
  siteId: string;
  siteName: string;
  inIso: string | null;
  outIso: string | null;
  inDistance: number;
  outDistance: number;
  inWithinGeofence: boolean | null;
  outWithinGeofence: boolean | null;
  inMapLink: string;
  outMapLink: string;
  notes: string;
};

function geofenceFlag(value: unknown): boolean | null {
  const v = String(value ?? "").trim().toUpperCase();
  if (!v) return null;
  return v === "YES" || v === "INSIDE";
}

export function parseVisits(rows: string[][]): Visit[] {
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      employeeId: String(r[0]).trim(),
      employeeName: String(r[1] ?? ""),
      siteId: String(r[2] ?? ""),
      siteName: String(r[3] ?? ""),
      inIso: istToIso(String(r[6] ?? ""), String(r[5] ?? "")),
      outIso: istToIso(String(r[12] ?? ""), String(r[11] ?? "")),
      inDistance: Number(r[8]) || 0,
      outDistance: Number(r[14]) || 0,
      inWithinGeofence: geofenceFlag(r[7]),
      outWithinGeofence: geofenceFlag(r[13]),
      inMapLink: String(r[9] ?? ""),
      outMapLink: String(r[15] ?? ""),
      notes: String(r[16] ?? ""),
    }));
}

export async function writeSiteVisit(data: GeoPayload & { action: string; siteId: string }) {
  const [name, sites] = await Promise.all([getEmployeeName(data.employeeId), getSites()]);
  const site = sites.find((s) => s.siteId === String(data.siteId));
  if (!site) throw new Error("Site not found.");

  const distance = distanceMeters(data.latitude, data.longitude, site.latitude, site.longitude);
  const withinGeofence = distance <= site.radius;
  const now = new Date();
  const link = mapsLink(data.latitude, data.longitude);

  if (data.action === "SITE_CHECK_IN") {
    // Guard: only one open visit at a time per employee.
    const existing = await readRangeFresh(SITEVISITS_RANGE);
    const open = existing.find(
      (r) =>
        String(r?.[0] ?? "").trim() === data.employeeId &&
        String(r?.[4] ?? "").trim() &&
        !String(r?.[10] ?? "").trim(),
    );
    if (open) {
      const openSite = String(open[3] ?? "the previous site");
      throw new Error(
        `You are still checked in at ${openSite}. Check out from there before starting a new site visit.`,
      );
    }
    await appendRow("SiteVisits!A:Q", [
      data.employeeId,
      name,
      site.siteId,
      site.siteName,
      "CHECKED IN",
      istTime(now),
      istDate(now),
      withinGeofence ? "INSIDE" : "OUTSIDE",
      Math.round(distance),
      link,
      "",
      "",
      "",
      "",
      "",
      "",
      data.notes ?? "",
    ]);
  } else {
    // SITE_CHECK_OUT: close the last open visit row for this employee + site.
    const rows = await readRangeFresh(SITEVISITS_RANGE);
    let target = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i] ?? [];
      if (
        String(r[0] ?? "").trim() === data.employeeId &&
        String(r[2] ?? "").trim() === String(site.siteId) &&
        !String(r[10] ?? "").trim()
      ) {
        target = i;
        break;
      }
    }

    if (target === -1) {
      await appendRow("SiteVisits!A:Q", [
        data.employeeId,
        name,
        site.siteId,
        site.siteName,
        "",
        "",
        "",
        "",
        "",
        "",
        "CHECKED OUT",
        istTime(now),
        istDate(now),
        withinGeofence ? "INSIDE" : "OUTSIDE",
        Math.round(distance),
        link,
        data.notes ?? "",
      ]);
    } else {
      const sheetRow = target + 2;
      // Only the check-out columns are written — the check-in status stays untouched.
      await updateRange(`SiteVisits!K${sheetRow}:Q${sheetRow}`, [
        [
          "CHECKED OUT",
          istTime(now),
          istDate(now),
          withinGeofence ? "INSIDE" : "OUTSIDE",
          Math.round(distance),
          link,
          data.notes ?? "",
        ],
      ]);
    }
  }

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
    readRange(ATTENDANCE_RANGE),
    readRange(SITEVISITS_RANGE),
  ]);

  const mine = parseShifts(attendanceRows)
    .filter(
      (s) =>
        s.employeeId === employeeId &&
        ((s.loginIso && isoDate(new Date(s.loginIso)) === date) ||
          (s.logoutIso && isoDate(new Date(s.logoutIso)) === date)),
    )
    .sort((a, b) => (a.loginIso ?? a.logoutIso ?? "").localeCompare(b.loginIso ?? b.logoutIso ?? ""));

  const myVisits = parseVisits(visitRows)
    .filter(
      (v) =>
        v.employeeId === employeeId &&
        ((v.inIso && isoDate(new Date(v.inIso)) === date) ||
          (v.outIso && isoDate(new Date(v.outIso)) === date)),
    )
    .sort((a, b) => (a.inIso ?? a.outIso ?? "").localeCompare(b.inIso ?? b.outIso ?? ""));

  let openShiftStart: string | null = null;
  let completedSeconds = 0;
  for (const s of mine) {
    if (s.loginIso && s.logoutIso) {
      completedSeconds += Math.max(
        0,
        (new Date(s.logoutIso).getTime() - new Date(s.loginIso).getTime()) / 1000,
      );
    } else if (s.loginIso && !s.logoutIso) {
      openShiftStart = s.loginIso;
    }
  }

  let openVisit: { siteId: string; siteName: string; startedAt: string } | null = null;
  for (const v of myVisits) {
    if (v.inIso && !v.outIso) {
      openVisit = { siteId: v.siteId, siteName: v.siteName, startedAt: v.inIso };
    }
  }

  const events: DayEvent[] = [
    ...mine.flatMap((s) => {
      const out: DayEvent[] = [];
      if (s.loginIso)
        out.push({
          timestamp: s.loginIso,
          type: "CHECK_IN",
          label: "Logged in",
          mapLink: s.mapLink,
          notes: s.notes,
        });
      if (s.logoutIso)
        out.push({
          timestamp: s.logoutIso,
          type: "CHECK_OUT",
          label: "Logged out",
          mapLink: s.mapLink,
          notes: s.notes,
        });
      return out;
    }),

    ...myVisits.flatMap((v) => {
      const out: DayEvent[] = [];
      if (v.inIso)
        out.push({
          timestamp: v.inIso,
          type: "SITE_CHECK_IN",
          label: `${v.siteName} — site in`,
          mapLink: v.inMapLink,
          distance: v.inDistance,
          ...(v.inWithinGeofence === null ? {} : { withinGeofence: v.inWithinGeofence }),
          notes: v.notes,
        });
      if (v.outIso)
        out.push({
          timestamp: v.outIso,
          type: "SITE_CHECK_OUT",
          label: `${v.siteName} — site out`,
          mapLink: v.outMapLink || v.inMapLink,
          distance: v.outDistance,
          ...(v.outWithinGeofence === null ? {} : { withinGeofence: v.outWithinGeofence }),
          notes: v.notes,
        });
      return out;
    }),

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
  const [employees, sites, attendanceRows, visitRows] = await Promise.all([
    getEmployees(),
    getSites(),
    readRange(ATTENDANCE_RANGE),
    readRange(SITEVISITS_RANGE),
  ]);


  const shifts = parseShifts(attendanceRows).filter(
    (s) =>
      (s.loginIso && isoDate(new Date(s.loginIso)) === date) ||
      (s.logoutIso && isoDate(new Date(s.logoutIso)) === date),
  );

  const attendance = shifts.flatMap((s) => {
    const base = {
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      accuracy: 0,
      mapLink: s.mapLink,
      notes: s.notes,
    };
    const out: (typeof base & { timestamp: string; action: string })[] = [];
    if (s.loginIso) out.push({ ...base, timestamp: s.loginIso, action: "CHECK_IN" });
    if (s.logoutIso) out.push({ ...base, timestamp: s.logoutIso, action: "CHECK_OUT" });
    return out;
  });


  const visits = parseVisits(visitRows)
    .filter(
      (v) =>
        (v.inIso && isoDate(new Date(v.inIso)) === date) ||
        (v.outIso && isoDate(new Date(v.outIso)) === date),
    )
    .flatMap((v) => {
      const base = {
        employeeId: v.employeeId,
        employeeName: v.employeeName,
        siteName: v.siteName,
        customer: "",
        accuracy: 0,
      };
      const out: (typeof base & {
        timestamp: string;
        action: string;
        distance: number;
        withinGeofence: boolean;
        mapLink: string;
      })[] = [];
      if (v.inIso)
        out.push({
          ...base,
          timestamp: v.inIso,
          action: "SITE_CHECK_IN",
          distance: v.inDistance,
          withinGeofence: v.inWithinGeofence ?? true,
          mapLink: v.inMapLink,
        });
      if (v.outIso)
        out.push({
          ...base,
          timestamp: v.outIso,
          action: "SITE_CHECK_OUT",
          distance: v.outDistance,
          withinGeofence: v.outWithinGeofence ?? true,
          mapLink: v.outMapLink || v.inMapLink,
        });
      return out;
    });


  const locations: {
    timestamp: string;
    employeeId: string;
    employeeName: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    mapLink: string;
  }[] = [];


  const roster = employees
    .filter((e) => e.active)
    .map((e) => {
      const own = shifts
        .filter((s) => s.employeeId === e.employeeId)
        .sort((a, b) =>
          (a.loginIso ?? a.logoutIso ?? "").localeCompare(b.loginIso ?? b.logoutIso ?? ""),
        );
      const firstIn = own.find((s) => s.loginIso)?.loginIso ?? null;
      const lastOut = [...own].reverse().find((s) => s.logoutIso)?.logoutIso ?? null;

      let openSince: string | null = null;
      let completedSeconds = 0;
      for (const s of own) {
        if (s.loginIso && s.logoutIso) {
          completedSeconds += Math.max(
            0,
            (new Date(s.logoutIso).getTime() - new Date(s.loginIso).getTime()) / 1000,
          );
        } else if (s.loginIso && !s.logoutIso) {
          openSince = s.loginIso;
        }
      }

      return {
        employeeId: e.employeeId,
        name: e.name,
        phone: e.phone,
        checkIn: firstIn ? timeLabel(firstIn) : "",
        checkOut: lastOut ? timeLabel(lastOut) : "",

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

/* ---------- admin override: force-close an open site visit ---------- */

export async function listOpenVisits() {
  const rows = await readRangeFresh(SITEVISITS_RANGE);
  return rows
    .map((r, i) => ({ r: r ?? [], sheetRow: i + 2 }))
    .filter(
      ({ r }) =>
        String(r[0] ?? "").trim() && String(r[4] ?? "").trim() && !String(r[10] ?? "").trim(),
    )
    .map(({ r, sheetRow }) => ({
      sheetRow,
      employeeId: String(r[0]).trim(),
      employeeName: String(r[1] ?? ""),
      siteId: String(r[2] ?? ""),
      siteName: String(r[3] ?? ""),
      inIso: istToIso(String(r[6] ?? ""), String(r[5] ?? "")),
      mapLink: String(r[9] ?? ""),
      notes: String(r[16] ?? ""),
    }));
}

export async function forceCloseVisit(input: { sheetRow: number; notes?: string }) {
  const rows = await readRangeFresh(SITEVISITS_RANGE);
  const row = rows[input.sheetRow - 2];
  if (!row || !String(row[0] ?? "").trim()) throw new Error("Visit row not found.");
  if (String(row[10] ?? "").trim()) throw new Error("This visit is already checked out.");

  const now = new Date();
  const existingNotes = String(row[16] ?? "").trim();
  const adminNote = (input.notes ?? "").trim() || "Force-closed by admin";
  await updateRange(`SiteVisits!K${input.sheetRow}:M${input.sheetRow}`, [
    ["CHECKED OUT (ADMIN)", istTime(now), istDate(now)],
  ]);
  await updateRange(`SiteVisits!Q${input.sheetRow}:Q${input.sheetRow}`, [
    [existingNotes ? `${existingNotes} | ${adminNote}` : adminNote],
  ]);


  return {
    success: true as const,
    employeeId: String(row[0]).trim(),
    siteName: String(row[3] ?? ""),
  };
}
