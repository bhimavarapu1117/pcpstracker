import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, LayoutDashboard, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminData } from "@/lib/attendance.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard | Field Attendance Tracking" },
      {
        name: "description",
        content:
          "Review daily crew attendance, site visits, geofence results and GPS location history stored in Google Sheets.",
      },
      { property: "og:title", content: "Admin Dashboard | Field Attendance Tracking" },
      {
        property: "og:description",
        content: "Daily attendance, site visits and GPS history for your pest control field team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminPage,
});

type Admin = Extract<Awaited<ReturnType<typeof getAdminData>>, { success: true }>["data"];

const today = () => new Date().toISOString().slice(0, 10);
const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toISOString().slice(11, 16);
};

function AdminPage() {
  const fetchAdmin = useServerFn(getAdminData);
  const [passcode, setPasscode] = useState("");
  const [date, setDate] = useState(today());
  const [data, setData] = useState<Admin | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(code = passcode, day = date) {
    setBusy(true);
    try {
      const res = await fetchAdmin({ data: { passcode: code, date: day } });
      if (!res.success) {
        toast.error(res.message);
        return;
      }
      setData(res.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load dashboard.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <LayoutDashboard className="size-5" />
            </span>
            <div>
              <h1 className="text-base font-semibold leading-tight">Admin dashboard</h1>
              <p className="text-xs text-muted-foreground">Attendance, site visits & GPS history</p>
            </div>
          </div>
          <Link
            to="/"
            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
          >
            Employee app
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {!data ? (
          <Card className="mx-auto max-w-md">
            <CardHeader>
              <CardTitle>Admin access</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  load();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="passcode">Passcode</Label>
                  <Input
                    id="passcode"
                    type="password"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Loading…" : "Open dashboard"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">Default passcode: 2468</p>
              </form>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="date" className="text-xs">
                  Date
                </Label>
                <Input
                  id="date"
                  type="date"
                  className="w-44"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    load(passcode, e.target.value);
                  }}
                />
              </div>
              <Button variant="outline" disabled={busy} onClick={() => load()}>
                <RefreshCw className="size-4" /> Refresh
              </Button>
              <a href={data.spreadsheetUrl} target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <ExternalLink className="size-4" /> Google Sheet
                </Button>
              </a>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Present today" value={`${data.totals.present}/${data.totals.employees}`} />
              <Stat label="Site visits" value={String(data.totals.visits)} />
              <Stat label="Outside geofence" value={String(data.totals.outsideGeofence)} />
              <Stat label="Active sites" value={String(data.sites.length)} />
            </div>

            <Tabs defaultValue="roster">
              <TabsList>
                <TabsTrigger value="roster">Attendance</TabsTrigger>
                <TabsTrigger value="visits">Site visits</TabsTrigger>
                <TabsTrigger value="history">Location history</TabsTrigger>
                <TabsTrigger value="sites">Sites</TabsTrigger>
              </TabsList>

              <TabsContent value="roster">
                <TableCard
                  head={["Employee", "ID", "Check in", "Check out", "Visits", "Last seen"]}
                  rows={data.roster.map((r) => [
                    r.name,
                    r.employeeId,
                    r.checkIn || "-",
                    r.checkOut || "-",
                    String(r.visits),
                    r.lastSeen ? (
                      <a
                        className="underline underline-offset-4"
                        href={r.lastSeen.mapLink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {time(r.lastSeen.timestamp)} · ±{r.lastSeen.accuracy} m
                      </a>
                    ) : (
                      "-"
                    ),
                  ])}
                />
              </TabsContent>

              <TabsContent value="visits">
                <TableCard
                  head={["Time", "Employee", "Site", "Action", "Distance", "Geofence", "Map"]}
                  rows={data.visits.map((v) => [
                    time(v.timestamp),
                    v.employeeName,
                    `${v.siteName} (${v.customer})`,
                    v.action.replace("SITE_", "").replace("_", " "),
                    `${v.distance} m`,
                    <Badge variant={v.withinGeofence ? "default" : "destructive"}>
                      {v.withinGeofence ? "Inside" : "Outside"}
                    </Badge>,
                    <MapLink href={v.mapLink} />,
                  ])}
                />
              </TabsContent>

              <TabsContent value="history">
                <TableCard
                  head={["Time", "Employee", "Latitude", "Longitude", "Accuracy", "Map"]}
                  rows={data.locations.map((l) => [
                    time(l.timestamp),
                    l.employeeName,
                    l.latitude.toFixed(6),
                    l.longitude.toFixed(6),
                    `±${l.accuracy} m`,
                    <MapLink href={l.mapLink} />,
                  ])}
                />
              </TabsContent>

              <TabsContent value="sites">
                <TableCard
                  head={["Site ID", "Site", "Customer", "Address", "Geofence"]}
                  rows={data.sites.map((s) => [
                    s.siteId,
                    s.siteName,
                    s.customer,
                    s.address,
                    `${s.radius} m`,
                  ])}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function MapLink({ href }: { href: string }) {
  if (!href) return <span>-</span>;
  return (
    <a className="underline underline-offset-4" href={href} target="_blank" rel="noreferrer">
      View
    </a>
  );
}

function TableCard({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <Card className="mt-4">
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {head.map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={head.length} className="text-center text-muted-foreground">
                  No records for this day.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow key={i}>
                  {row.map((cell, j) => (
                    <TableCell key={j}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
