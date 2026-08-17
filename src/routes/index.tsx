import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  MapPin,
  LogIn,
  LogOut,
  Satellite,
  ShieldCheck,
  ShieldAlert,
  Radio,
  Building2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loginEmployee,
  listSites,
  recordAttendance,
  recordSiteVisit,
  recordLocation,
} from "@/lib/attendance.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Field Attendance | Pest Control GPS Time Tracking" },
      {
        name: "description",
        content:
          "Employee GPS attendance for pest control crews: start-day check-in, site visits with geofence validation and live location tracking.",
      },
      { property: "og:title", content: "Field Attendance | Pest Control GPS Time Tracking" },
      {
        property: "og:description",
        content:
          "Clock in with GPS, check in and out of customer sites with geofence validation, and log location history to Google Sheets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FieldApp,
});

const LOCATION_INTERVAL = 60000;

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

function FieldApp() {
  const [session, setSession] = useState<{ employeeId: string; name: string } | null>(null);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Satellite className="size-5" />
            </span>
            <div>
              <h1 className="text-base font-semibold leading-tight">Field Attendance</h1>
              <p className="text-xs text-muted-foreground">Pest control GPS tracking</p>
            </div>
          </div>
          <Link
            to="/admin"
            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
          >
            Admin
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6">
        {session ? (
          <Workspace session={session} onLogout={() => setSession(null)} />
        ) : (
          <LoginCard onLogin={setSession} />
        )}
      </div>
    </main>
  );
}

function LoginCard({ onLogin }: { onLogin: (s: { employeeId: string; name: string }) => void }) {
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
    <Card>
      <CardHeader>
        <CardTitle>Employee sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="employeeId">Employee ID</Label>
            <Input
              id="employeeId"
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
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Demo login: EMP001 / 1234
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function Workspace({
  session,
  onLogout,
}: {
  session: { employeeId: string; name: string };
  onLogout: () => void;
}) {
  const sitesFn = useServerFn(listSites);
  const attendanceFn = useServerFn(recordAttendance);
  const visitFn = useServerFn(recordSiteVisit);
  const locationFn = useServerFn(recordLocation);

  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [siteId, setSiteId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [tracking, setTracking] = useState(false);
  const [pings, setPings] = useState(0);
  const trackingRef = useRef(tracking);
  trackingRef.current = tracking;

  const sites = useQuery({ queryKey: ["sites"], queryFn: () => sitesFn({}) });

  const refreshFix = useCallback(async () => {
    try {
      const next = await getFix();
      setFix(next);
      setGpsError(null);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "GPS unavailable.";
      setGpsError(message);
      throw err;
    }
  }, []);

  useEffect(() => {
    refreshFix().catch(() => undefined);
  }, [refreshFix]);

  useEffect(() => {
    if (!tracking) return;
    let cancelled = false;

    const ping = async () => {
      try {
        const next = await getFix();
        if (cancelled) return;
        setFix(next);
        await locationFn({
          data: {
            employeeId: session.employeeId,
            latitude: next.latitude,
            longitude: next.longitude,
            accuracy: next.accuracy,
          },
        });
        if (!cancelled) setPings((p) => p + 1);
      } catch {
        /* keep trying on the next tick */
      }
    };

    ping();
    const id = setInterval(ping, LOCATION_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tracking, locationFn, session.employeeId]);

  async function withFix(run: (f: Fix) => Promise<void>) {
    setBusy(true);
    try {
      const current = await refreshFix();
      await run(current);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const day = (action: "CHECK_IN" | "CHECK_OUT") =>
    withFix(async (f) => {
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
      toast.success(action === "CHECK_IN" ? "Day started" : "Day ended");
    });

  const visit = (action: "SITE_CHECK_IN" | "SITE_CHECK_OUT") => {
    if (!siteId) {
      toast.error("Select a site first.");
      return;
    }
    return withFix(async (f) => {
      const res = await visitFn({
        data: {
          employeeId: session.employeeId,
          siteId,
          action,
          latitude: f.latitude,
          longitude: f.longitude,
          accuracy: f.accuracy,
          notes,
        },
      });
      setNotes("");
      if (res.withinGeofence) {
        toast.success(`${res.siteName}: recorded (${res.distance} m from site)`);
      } else {
        toast.warning(
          `Outside geofence — ${res.distance} m from ${res.siteName}. Logged for review.`,
        );
      }
    });
  };

  const selectedSite = sites.data?.find((s) => s.siteId === siteId);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm text-muted-foreground">Signed in as</p>
            <p className="font-semibold">{session.name}</p>
            <p className="text-xs text-muted-foreground">{session.employeeId}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onLogout}>
            Sign out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4" /> GPS position
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {fix ? (
            <div className="space-y-1 text-sm">
              <p className="font-mono">
                {fix.latitude.toFixed(6)}, {fix.longitude.toFixed(6)}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={fix.accuracy <= 30 ? "default" : "secondary"}>
                  Accuracy ±{fix.accuracy} m
                </Badge>
                <a
                  className="text-xs underline underline-offset-4"
                  href={`https://www.google.com/maps?q=${fix.latitude},${fix.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Google Maps
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {gpsError ?? "Getting your location…"}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshFix().catch(() => toast.error(gpsError ?? "GPS unavailable."))}
          >
            Refresh GPS
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Work day</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Button disabled={busy} onClick={() => day("CHECK_IN")}>
            <LogIn className="size-4" /> Start day
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => day("CHECK_OUT")}>
            <LogOut className="size-4" /> End day
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" /> Site visit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={siteId} onValueChange={setSiteId}>
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
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              {fix ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
              {selectedSite.address} · geofence {selectedSite.radius} m
            </p>
          ) : null}

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (treatment done, chemicals used, observations…)"
            rows={3}
          />

          <div className="grid grid-cols-2 gap-3">
            <Button disabled={busy} onClick={() => visit("SITE_CHECK_IN")}>
              Site check-in
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => visit("SITE_CHECK_OUT")}>
              Site check-out
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="size-4" /> Live tracking
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Log my location every minute</p>
              <p className="text-xs text-muted-foreground">
                {tracking ? `${pings} location(s) logged this session` : "Currently off"}
              </p>
            </div>
            <Switch checked={tracking} onCheckedChange={setTracking} />
          </div>
          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            Tracking only runs while this page stays open and location permission is granted. For
            all-day background tracking, a native Android app is the right architecture.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
