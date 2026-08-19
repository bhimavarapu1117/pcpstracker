import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type OAuthClient = { name?: string; redirect_uri?: string };
type AuthorizationDetails = {
  client?: OAuthClient;
  scope?: string;
  redirect_url?: string;
  redirect_to?: string;
};

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
};

const oauthApi = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s['authorization_id'] === "string" ? (s['authorization_id'] as string) : "",
  }),
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id") ?? "";
    if (!authorizationId) throw new Error("Missing authorization_id");
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { needsAuth: true as const, details: null, email: null };
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return {
      needsAuth: false as const,
      details: data,
      email: sessionData.session.user.email ?? null,
    };
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen grid place-items-center p-6">
      <p className="text-sm text-muted-foreground">
        Could not load this authorization request: {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

function Consent() {
  const loaded = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signedIn, setSignedIn] = useState(!loaded.needsAuth);

  useEffect(() => {
    if (signedIn && loaded.needsAuth) window.location.reload();
  }, [signedIn, loaded.needsAuth]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    setSignedIn(true);
  }

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error: decideError } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (decideError) {
      setBusy(false);
      setError(decideError.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  if (loaded.needsAuth) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <form
          onSubmit={signIn}
          className="w-full max-w-sm rounded-3xl bg-card/90 backdrop-blur p-6 shadow-lg space-y-4"
        >
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Sign in to continue</h1>
            <p className="text-sm text-muted-foreground">
              Sign in with your POPSTracker account to approve this connection.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </main>
    );
  }

  const client = loaded.details?.client;

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-card/90 backdrop-blur p-6 shadow-lg space-y-4">
        <h1 className="text-xl font-semibold">
          Connect {client?.name ?? "an app"} to POPSTracker
        </h1>
        {loaded.email && (
          <p className="text-sm text-muted-foreground">Signed in as {loaded.email}</p>
        )}
        <p className="text-sm">
          {client?.name ?? "This client"} will be able to call this app&apos;s enabled tools while
          you are signed in — reading employees, sites and attendance reports.
        </p>
        {client?.redirect_uri && (
          <p className="text-xs text-muted-foreground break-all">
            Redirects to {client.redirect_uri}
          </p>
        )}
        {loaded.details?.scope && (
          <p className="text-xs text-muted-foreground">Requested: {loaded.details.scope}</p>
        )}
        <p className="text-xs text-muted-foreground">
          This does not bypass this app&apos;s permissions or backend policies.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button disabled={busy} onClick={() => decide(true)} className="flex-1">
            Approve
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => decide(false)} className="flex-1">
            Cancel connection
          </Button>
        </div>
      </div>
    </main>
  );
}
