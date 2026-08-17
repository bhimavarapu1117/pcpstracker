import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MapPin,
  
  Building2,
  Clock,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import popsLogo from "@/assets/pops-logo-transparent.png";
import { useElapsed, formatDuration, formatShort } from "@/hooks/use-elapsed";
import { cn } from "@/lib/utils";

import {
  loginEmployee,
  listSites,
  refreshSites,
  recordAttendance,
  recordSiteVisit,
  getTodayStatus,
} from "@/lib/attendance.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Field Attendance | Pest Control GPS Time Tracking" },
      {
        name: "description",
        content:
          "Employee GPS attendance for pest control crews: live running work timer, site visits with geofence validation and location tracking.",
      },
      { property: "og:title", content: "Field Attendance | Pest Control GPS Time Tracking" },
      {
        property: "og:description",
        content:
          "Clock in with a live running timer, check in and out of customer sites with geofence validation, and log location history to Google Sheets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FieldApp,
});


const SESSION_KEY = "field-attendance-session";

type Session = { employeeId: string; name: string };
type Fix = { latitude: number; longitude: number; accuracy: number; at: number };

function getFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracy: Math.round(pos.coords.accuracy),
          at: Date.now(),
        }),
      (err) => reject(new Error(err.message || "Unable to get GPS location.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
) {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function hhmm(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const date = d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date} · ${time}`;
}


function FieldApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) setSession(JSON.parse(raw) as Session);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const signIn = (s: Session) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
    setDayOpen(true);
  };
  const signOut = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setDayOpen(false);
  };

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-5">
        {ready && session ? (
          <>
            <header className="flex items-center justify-center py-2">
              <img src={popsLogo} alt="POPS Pest Care Pvt Ltd logo" className="h-10 w-auto" />
            </header>
            <div className="mt-6">
              <h1 className="text-2xl font-semibold tracking-tight">
                Hi, <span className="text-primary">{session.name}</span>
              </h1>
              <p className="text-sm text-muted-foreground">Here’s your day on the field.</p>
            </div>
            <div className="py-5">
              <Workspace session={session} onLogout={signOut} dayOpen={dayOpen} setDayOpen={setDayOpen} />
            </div>
          </>
        ) : null}
      </div>

      <Dialog open={ready && !session} onOpenChange={() => {}}>
        <DialogContent
          overlayClassName="bg-transparent"
          className="w-[calc(100%-2rem)] max-w-[22rem] rounded-3xl border-0 bg-card/85 p-5 shadow-lg backdrop-blur sm:w-full sm:max-w-sm sm:p-6 [&>button]:hidden"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <LoginCard onLogin={signIn} />
        </DialogContent>
      </Dialog>
    </main>
  );
}

function LoginCard({ onLogin }: { onLogin: (s: Session) => void }) {
  const login = useServerFn(loginEmployee);
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await login({ data: { employeeId, pin } });
      if (!res.success) {
        toast.error(res.message);
        return;
      }
      onLogin({ employeeId: res.employeeId, name: res.name });
      toast.success(`Welcome, ${res.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <DialogHeader>
        <DialogTitle className="sr-only">Employee sign in</DialogTitle>
      </DialogHeader>
      <img src={popsLogo} alt="POPS Pest Care Pvt Ltd logo" className="mb-6 h-16 w-auto" />
      <form onSubmit={submit} className="w-full space-y-4">
        <div className="space-y-2">
          <Label htmlFor="employeeId">Employee ID</Label>
          <Input
            id="employeeId"
            className="rounded-full"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            placeholder="EMP001"
            autoComplete="username"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pin">PIN</Label>
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            className="rounded-full"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            autoComplete="current-password"
            required
          />
        </div>
        <Button
          type="submit"
          className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={busy}
        >
          {busy ? "Checking…" : "Sign in"}
        </Button>
        <Link
          to="/admin"
          className="block w-full rounded-full border bg-card px-4 py-2 text-center text-sm font-medium transition-colors hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
        >
          Admin
        </Link>
        
      </form>
    </div>
  );
}


function Clockface() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <p className="text-sm text-muted-foreground">&nbsp;</p>;
  return (
    <p className="text-sm text-muted-foreground">
      {now.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      })}{" "}
      ·{" "}
      {now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
    </p>
  );
}

function Workspace({ session, onLogout, dayOpen, setDayOpen }: { session: Session; onLogout: () => void; dayOpen: boolean; setDayOpen: (v: boolean) => void; }) {
  const sitesFn = useServerFn(listSites);
  const refreshSitesFn = useServerFn(refreshSites);
  const statusFn = useServerFn(getTodayStatus);
  const attendanceFn = useServerFn(recordAttendance);
  const visitFn = useServerFn(recordSiteVisit);
  const queryClient = useQueryClient();

  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [siteId, setSiteId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [frozenWorkSeconds, setFrozenWorkSeconds] = useState<number | null>(null);
  const [refreshingSites, setRefreshingSites] = useState(false);
  const [rangeKey, setRangeKey] = useState<string>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(1);

  const sites = useQuery({
    queryKey: ["sites"],
    queryFn: () => sitesFn({}),
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
  const status = useQuery({
    queryKey: ["today", session.employeeId],
    queryFn: () => statusFn({ data: { employeeId: session.employeeId } }),
    refetchOnWindowFocus: true,
  });

  const handleRefreshSites = async () => {
    setRefreshingSites(true);
    try {
      const fresh = await refreshSitesFn({});
      queryClient.setQueryData(["sites"], fresh);
      toast.success("Sites refreshed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refresh sites.");
    } finally {
      setRefreshingSites(false);
    }
  };

  const openShiftStart = status.data?.openShiftStart ?? null;
  const openVisit = status.data?.openVisit ?? null;
  const completed = status.data?.completedSeconds ?? 0;

  const workSeconds = useElapsed(openShiftStart, completed);
  const displayedWorkSeconds = frozenWorkSeconds ?? workSeconds;
  const visitSeconds = useElapsed(openVisit?.startedAt ?? null, 0);

  const allEvents = status.data?.events ?? [];
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const filteredEvents = allEvents.filter((e) => {
    const t = new Date(e.timestamp).getTime();
    if (Number.isNaN(t)) return false;
    const today = startOfDay(new Date());
    const day = 86_400_000;
    if (rangeKey === "today") return t >= today;
    if (rangeKey === "yesterday") return t >= today - day && t < today;
    if (rangeKey === "7d") return t >= today - 6 * day;
    if (rangeKey === "30d") return t >= today - 29 * day;
    if (rangeKey === "custom") {
      const from = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : -Infinity;
      const to = customTo ? new Date(`${customTo}T23:59:59.999`).getTime() : Infinity;
      return t >= from && t <= to;
    }
    return true;
  });
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedEvents = filteredEvents.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeStart = filteredEvents.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, filteredEvents.length);

  useEffect(() => {
    if (openVisit) setSiteId(openVisit.siteId);
  }, [openVisit]);

  const refreshFix = useCallback(async () => {
    try {
      const next = await getFix();
      setFix(next);
      setGpsError(null);
      return next;
    } catch (err) {
      setGpsError(err instanceof Error ? err.message : "GPS unavailable.");
      throw err;
    }
  }, []);

  useEffect(() => {
    refreshFix().catch(() => undefined);
  }, [refreshFix]);


  async function withFix(run: (f: Fix) => Promise<void>) {
    setBusy(true);
    try {
      const current = await refreshFix();
      await run(current);
      await status.refetch();
      setFrozenWorkSeconds(null);
    } catch (err) {
      setFrozenWorkSeconds(null);
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
      await status.refetch().catch(() => undefined);

    } finally {
      setBusy(false);
    }
  }

  const toggleDay = () =>
    withFix(async (f) => {
      const action = openShiftStart ? "CHECK_OUT" : "CHECK_IN";
      if (action === "CHECK_OUT") {
        setFrozenWorkSeconds(workSeconds);
      } else {
        setFrozenWorkSeconds(null);
      }
      await attendanceFn({
        data: {
          employeeId: session.employeeId,
          action,
          latitude: f.latitude,
          longitude: f.longitude,
          accuracy: f.accuracy,
          notes,
        },
      });
      setNotes("");
      toast.success(action === "CHECK_IN" ? "Logged in — timer running" : "Logged out");
    });

  const toggleVisit = () => {
    const target = openVisit?.siteId ?? siteId;
    if (!target) {
      toast.error("Select a site first.");
      return;
    }
    if (openVisit && siteId && siteId !== openVisit.siteId) {
      toast.error(
        `You are still checked in at ${openVisit.siteName}. Check out from there before starting a new site visit.`,
      );
      return;
    }

    return withFix(async (f) => {
      const res = await visitFn({
        data: {
          employeeId: session.employeeId,
          siteId: target,
          action: openVisit ? "SITE_CHECK_OUT" : "SITE_CHECK_IN",
          latitude: f.latitude,
          longitude: f.longitude,
          accuracy: f.accuracy,
          notes,
        },
      });
      setNotes("");
      if (res.withinGeofence) {
        toast.success(`${res.siteName}: recorded`);
      } else {
        toast.warning(`You appear to be away from ${res.siteName}. Logged for review.`);
      }
    });
  };

  const selectedSite = sites.data?.find((s) => s.siteId === (openVisit?.siteId ?? siteId));
  const siteDistance =
    selectedSite && fix
      ? distanceMeters(fix.latitude, fix.longitude, selectedSite.latitude, selectedSite.longitude)
      : null;
  const inGeofence =
    siteDistance !== null && selectedSite ? siteDistance <= selectedSite.radius : null;
  const running = Boolean(openShiftStart);

  return (
    <div className="space-y-4">
      {/* Compact status bar — tap to open day controls */}
      <button
        type="button"
        onClick={() => setDayOpen(true)}
        className="flex w-full items-center gap-3 rounded-full border-0 bg-card px-4 py-3 text-left shadow-sm"
      >
        <span
          className={`size-2.5 shrink-0 rounded-full ${running ? "bg-primary animate-pulse" : "bg-muted-foreground/40"}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-lg font-semibold tabular-nums leading-tight">
            {formatDuration(displayedWorkSeconds)}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {running
              ? `Working since ${hhmm(openShiftStart!)}`
              : completed > 0
                ? `Done for today · ${formatShort(completed)}`
                : "Not logged in"}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
            running
              ? "bg-destructive text-destructive-foreground"
              : "bg-google-green text-google-green-foreground"
          }`}
        >
          {running ? "Logout" : "Login"}
        </span>
      </button>

      <Dialog open={dayOpen} onOpenChange={setDayOpen}>
        <DialogContent className="rounded-3xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center text-base">{session.name} · {session.employeeId}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 pb-2">
            <Clockface />
            <p
              className={`font-mono text-5xl font-semibold tabular-nums ${
                running ? "text-primary" : "text-foreground"
              }`}
            >
            {formatDuration(displayedWorkSeconds)}
            </p>
            <Badge variant={running ? "default" : "secondary"} className="gap-1">
              <Clock className="size-3.5" />
              {running
                ? `Working since ${hhmm(openShiftStart!)}`
                : completed > 0
                  ? `Done for today · ${formatShort(completed)}`
                  : "Not logged in"}
            </Badge>

            <Button
              size="lg"
              className={cn(
                "w-full",
                !running && "bg-google-green text-google-green-foreground hover:bg-google-green/90"
              )}
              variant={running ? "destructive" : "default"}
              disabled={busy || status.isLoading}
              onClick={async () => {
                await toggleDay();
                setDayOpen(false);
              }}
            >
              {busy ? "Saving…" : running ? "Logout" : "Login"}
            </Button>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {fix ? "Location ready" : (gpsError ?? "Getting your location…")}
              </span>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="text-xs font-medium text-muted-foreground underline underline-offset-4"
            >
              Sign out
            </button>
          </div>
        </DialogContent>
      </Dialog>


      {/* Site visit */}
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" /> Site visit
            <button
              type="button"
              onClick={handleRefreshSites}
              disabled={refreshingSites}
              className="ml-auto inline-flex items-center gap-1 rounded-full p-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              aria-label="Refresh sites"
            >
              <RefreshCw className={cn("size-3.5", refreshingSites && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            {openVisit ? (
              <span className="font-mono text-sm tabular-nums text-primary">
                {formatDuration(visitSeconds)}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={siteId} onValueChange={setSiteId} disabled={Boolean(openVisit)}>
            <SelectTrigger>
              <SelectValue placeholder={sites.isLoading ? "Loading sites…" : "Select a site"} />
            </SelectTrigger>
            <SelectContent>
              {(sites.data ?? []).map((s) => (
                <SelectItem key={s.siteId} value={s.siteId}>
                  {s.siteName} — {s.customer}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedSite ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {selectedSite.address}
                {openVisit ? ` · on site since ${hhmm(openVisit.startedAt)}` : ""}
              </p>
              {inGeofence === null ? (
                <Badge variant="secondary" className="gap-1">
                  <MapPin className="size-3.5" /> Checking geofence…
                </Badge>
              ) : inGeofence ? (
                <Badge className="gap-1 bg-google-green text-google-green-foreground hover:bg-google-green/90">
                  <MapPin className="size-3.5" /> On site — in geofence ({siteDistance} m of{" "}
                  {selectedSite.radius} m)
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <MapPin className="size-3.5" /> Outside geofence · {siteDistance} m away (limit{" "}
                  {selectedSite.radius} m)
                </Badge>
              )}
            </div>
          ) : null}

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (treatment done, chemicals used, observations…)"
            rows={3}
          />

          <Button
            className={cn(
              "w-full",
              !openVisit && "hover:bg-primary hover:text-primary-foreground"
            )}
            variant={openVisit ? "destructive" : "secondary"}
            disabled={busy}
            onClick={toggleVisit}
          >
            {openVisit ? "Site check-out" : "Site check-in"}
          </Button>
        </CardContent>
      </Card>

      {/* Activity timeline */}
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Select
                value={rangeKey}
                onValueChange={(v) => {
                  setRangeKey(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 w-[150px] rounded-full">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="custom">Custom dates</SelectItem>
                </SelectContent>
              </Select>
              {rangeKey === "custom" ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => {
                      setCustomFrom(e.target.value);
                      setPage(1);
                    }}
                    className="h-9 w-[140px] rounded-full"
                  />
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(e) => {
                      setCustomTo(e.target.value);
                      setPage(1);
                    }}
                    className="h-9 w-[140px] rounded-full"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {status.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filteredEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity for this period.</p>
          ) : (
            <>
              <ol className="space-y-3">
                {pagedEvents.map((e, i) => (
                  <li key={`${e.timestamp}-${i}`} className="flex items-start gap-3 text-sm">
                    <span
                      className={cn(
                        "mt-1 size-2 shrink-0 rounded-full",
                        e.type === "CHECK_IN" && "bg-google-green",
                        e.type === "CHECK_OUT" && "bg-destructive",
                        e.type !== "CHECK_IN" && e.type !== "CHECK_OUT" && "bg-primary",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{e.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(e.timestamp)}
                        {e.notes ? ` · ${e.notes}` : ""}
                      </p>
                    </div>
                    {e.withinGeofence === false ? (
                      <Badge variant="destructive" className="shrink-0">
                        Outside
                      </Badge>
                    ) : e.withinGeofence === true ? (
                      <Badge className="shrink-0 bg-google-green text-google-green-foreground hover:bg-google-green/90">
                        Inside
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ol>

              <div className="mt-4 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {rangeStart}–{rangeEnd} of {filteredEvents.length}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
