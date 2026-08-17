import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const geo = {
  employeeId: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number(),
  notes: z.string().optional(),
};

export const loginEmployee = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ employeeId: z.string().min(1), pin: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getEmployees } = await import("./sheets.server");
    const employees = await getEmployees();
    const match = employees.find(
      (e) =>
        e.employeeId.toLowerCase() === data.employeeId.trim().toLowerCase() &&
        e.pin === data.pin.trim() &&
        e.active,
    );
    if (!match) return { success: false as const, message: "Invalid Employee ID or PIN." };
    return { success: true as const, employeeId: match.employeeId, name: match.name };
  });

export const listSites = createServerFn({ method: "GET" }).handler(async () => {
  const { getSites } = await import("./sheets.server");
  return getSites();
});

export const refreshSites = createServerFn({ method: "GET" }).handler(async () => {
  const { invalidateReads, getSites } = await import("./sheets.server");
  invalidateReads();
  return getSites();
});

export const getTodayStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ employeeId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { readTodayForEmployee } = await import("./sheets.server");
    return readTodayForEmployee(data.employeeId);
  });


export const recordAttendance = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ ...geo, action: z.enum(["CHECK_IN", "CHECK_OUT"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { writeAttendance } = await import("./sheets.server");
    return writeAttendance(data);
  });

export const recordSiteVisit = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        ...geo,
        siteId: z.string().min(1),
        action: z.enum(["SITE_CHECK_IN", "SITE_CHECK_OUT"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { writeSiteVisit } = await import("./sheets.server");
    return writeSiteVisit(data);
  });

export const recordLocation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object(geo).parse(d))
  .handler(async ({ data }) => {
    const { writeLocation } = await import("./sheets.server");
    return writeLocation(data);
  });

export const getAdminData = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ passcode: z.string().min(1), date: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const expected = process.env["ADMIN_PASSCODE"] ?? "2468";
    if (data.passcode.trim() !== expected) {
      return { success: false as const, message: "Incorrect admin passcode." };
    }
    const { buildAdminData, isoDate } = await import("./sheets.server");
    return { success: true as const, data: await buildAdminData(data.date || isoDate()) };
  });

export const listOpenVisitsAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ passcode: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const expected = process.env["ADMIN_PASSCODE"] ?? "2468";
    if (data.passcode.trim() !== expected) {
      return { success: false as const, message: "Incorrect admin passcode." };
    }
    const { listOpenVisits } = await import("./sheets.server");
    try {
      return { success: true as const, visits: await listOpenVisits() };
    } catch (err) {
      console.error("listOpenVisitsAdmin failed", err);
      return { success: true as const, visits: [] };
    }

  });

export const listOpenShiftsAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ passcode: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const expected = process.env["ADMIN_PASSCODE"] ?? "2468";
    if (data.passcode.trim() !== expected) {
      return { success: false as const, message: "Incorrect admin passcode." };
    }
    const { listOpenShifts } = await import("./sheets.server");
    try {
      return { success: true as const, shifts: await listOpenShifts() };
    } catch (err) {
      console.error("listOpenShiftsAdmin failed", err);
      return { success: true as const, shifts: [] };
    }
  });

export const forceCloseShiftAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        passcode: z.string().min(1),
        sheetRow: z.number().int().positive(),
        notes: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const expected = process.env["ADMIN_PASSCODE"] ?? "2468";
    if (data.passcode.trim() !== expected) {
      return { success: false as const, message: "Incorrect admin passcode." };
    }
    const { forceCloseShift } = await import("./sheets.server");
    return forceCloseShift(data.sheetRow, data.notes);
  });

export const forceCloseVisitAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        passcode: z.string().min(1),
        sheetRow: z.number().int().positive(),
        notes: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const expected = process.env["ADMIN_PASSCODE"] ?? "2468";
    if (data.passcode.trim() !== expected) {
      return { success: false as const, message: "Incorrect admin passcode." };
    }
    const { forceCloseVisit } = await import("./sheets.server");
    const res = await forceCloseVisit({ sheetRow: data.sheetRow, ...(data.notes ? { notes: data.notes } : {}) });
    return res;
  });

