import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  MapPin,
  Play,
  Square,
  Satellite,
  
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
import popsLogo from "@/assets/pops-logo.png.asset.json";
import { useElapsed, formatDuration, formatShort } from "@/hooks/use-elapsed";

import {
  loginEmployee,
  listSites,
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

function hhmm(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function FieldApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

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
  };
  const signOut = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  };

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-5">
        <header className="flex items-center justify-between gap-3 rounded-full border bg-card/80 px-3 py-2 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Satellite className="size-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Attendance Tracker</span>
          </div>

          <Link
            to="/admin"
            className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background"
          >
            Admin
          </Link>
        </header>

        {session ? (
          <div className="mt-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              Hi, <span className="text-primary">{session.name}</span>
            </h1>
            <p className="text-sm text-muted-foreground">Here’s your day on the field.</p>
          </div>
        ) : null}

        <div className="py-5">
          {!ready ? null : session ? (
            <Workspace session={session} onLogout={signOut} />
          ) : (
            <LoginCard onLogin={signIn} />
          )}
        </div>
      </div>
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
    <Card className="mx-auto max-w-md rounded-3xl border-0 bg-card/85 shadow-lg backdrop-blur">
      <CardHeader className="items-center pb-2">
        <img src={popsLogo.url} alt="POPS Pest Care Pvt Ltd logo" className="h-16 w-auto" />
        <CardTitle className="sr-only">Employee sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
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
            className="w-full rounded-full bg-accent text-accent-foreground hover:bg-accent/90"
            disabled={busy}
          >
            {busy ? "Checking…" : "Sign in"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">Demo login: EMP001 / 1234</p>
        </form>
      </CardContent>
    </Card>
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
      {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ·{" "}
      {now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
    </p>
  );
}

function Workspace({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const sitesFn = useServerFn(listSites);
  const statusFn = useServerFn(getTodayStatus);
  const attendanceFn = useServerFn(recordAttendance);
  const visitFn = useServerFn(recordSiteVisit);
  

  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [siteId, setSiteId] = useState<string>("");
  const [notes, setNotes] = useState("");

  const sites = useQuery({ queryKey: ["sites"], queryFn: () => sitesFn({}) });
  const status = useQuery({
    queryKey: ["today", session.employeeId],
    queryFn: () => statusFn({ data: { employeeId: session.employeeId } }),
    refetchOnWindowFocus: true,
  });

  const openShiftStart = status.data?.openShiftStart ?? null;
  const openVisit = status.data?.openVisit ?? null;
  const completed = status.data?.completedSeconds ?? 0;

  const workSeconds = useElapsed(openShiftStart, completed);
  const visitSeconds = useElapsed(openVisit?.startedAt ?? null, 0);

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const toggleDay = () =>
    withFix(async (f) => {
      const action = openShiftStart ? "CHECK_OUT" : "CHECK_IN";
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
  const running = Boolean(openShiftStart);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{session.employeeId}</span>
        <button
          type="button"
          onClick={onLogout}
          className="rounded-full border bg-card px-3 py-1 font-medium text-foreground"
        >
          Sign out
        </button>
      </div>

      {/* Live clock */}
      <Card className="overflow-hidden rounded-3xl border-0 bg-card shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 py-8">

          <Clockface />
          <p
            className={`font-mono text-5xl font-semibold tabular-nums ${
              running ? "text-primary" : "text-foreground"
            }`}
          >
            {formatDuration(workSeconds)}
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
            className="w-full max-w-xs"
            variant={running ? "destructive" : "default"}
            disabled={busy || status.isLoading}
            onClick={toggleDay}
          >
            {running ? <Square className="size-4" /> : <Play className="size-4" />}
            {busy ? "Saving…" : running ? "Logout" : "Login"}
          </Button>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {fix ? "Location ready" : (gpsError ?? "Getting your location…")}
            </span>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 underline underline-offset-4"
              onClick={() => refreshFix().catch(() => toast.error(gpsError ?? "GPS unavailable."))}
            >
              <RefreshCw className="size-3" /> Refresh
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Site visit */}
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" /> Site visit
            {openVisit ? (
              <span className="ml-auto font-mono text-sm tabular-nums text-primary">
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
            <p className="text-xs text-muted-foreground">
              {selectedSite.address}
              {openVisit ? ` · on site since ${hhmm(openVisit.startedAt)}` : ""}
            </p>
          ) : null}

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (treatment done, chemicals used, observations…)"
            rows={3}
          />

          <Button
            className="w-full"
            variant={openVisit ? "destructive" : "secondary"}
            disabled={busy}
            onClick={toggleVisit}
          >
            {openVisit ? "Site check-out" : "Site check-in"}
          </Button>
        </CardContent>
      </Card>

      {/* Today's timeline */}
      <Card className="rounded-3xl border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Today’s activity</CardTitle>
        </CardHeader>
        <CardContent>
          {status.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (status.data?.events.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No activity logged yet today.</p>
          ) : (
            <ol className="space-y-3">
              {status.data!.events.map((e, i) => (
                <li key={`${e.timestamp}-${i}`} className="flex items-start gap-3 text-sm">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{e.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {hhmm(e.timestamp)}
                      {e.notes ? ` · ${e.notes}` : ""}
                    </p>
                  </div>
                  {e.withinGeofence === false ? (
                    <Badge variant="destructive" className="shrink-0">
                      Outside
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
