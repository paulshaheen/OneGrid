import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Wind } from "lucide-react";

import { auth } from "@/lib/auth/session";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  head: () => ({
    meta: [
      { title: "Sign in | Weather & Asset Risk" },
      {
        name: "description",
        content:
          "Sign in with Microsoft Entra ID to open your tenant's hurricane and asset risk operations console.",
      },
      { property: "og:title", content: "Sign in | Weather & Asset Risk" },
      {
        property: "og:description",
        content: "Microsoft Entra ID single sign-on for operations teams.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function safePath(value: string | undefined) {
  if (!value) return "/app";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return "/app";
    return url.pathname + url.search;
  } catch {
    return "/app";
  }
}

function AuthPage() {
  const search = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace(safePath(search.redirect));
    });
  }, [search.redirect]);

  async function signInWithEntra() {
    setError(null);
    setBusy(true);
    // Remember where to land once the identity platform redirects back.
    sessionStorage.setItem("post-auth-path", safePath(search.redirect));
    const { error: err } = await auth.signInWithEntra();
    if (err) {
      setBusy(false);
      setError(err.message);
    }
    // On success the browser navigates to Entra; nothing else runs here.
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      {/* Subtle ambient backdrop — restrained, enterprise, not decorative noise. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_60rem_at_50%_-10%,color-mix(in_oklab,var(--color-primary)_10%,transparent),transparent)]"
      />

      <div className="flex w-full max-w-[360px] flex-col items-center">
        <Link
          to="/"
          className="flex flex-col items-center gap-3"
          aria-label="Asset Weather Ops home"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Wind className="size-5" />
          </span>
          <span className="text-[13px] font-medium tracking-wide text-muted-foreground">
            Asset Weather Ops
          </span>
        </Link>

        <h1 className="mt-8 text-center text-[1.75rem] font-semibold leading-tight tracking-tight">
          Sign in
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Continue with your work or school account.
        </p>

        <button
          onClick={() => void signInWithEntra()}
          disabled={busy}
          className="mt-8 flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border bg-card px-4 text-sm font-medium shadow-sm transition-all hover:bg-accent hover:shadow disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <svg viewBox="0 0 23 23" className="size-[18px]" aria-hidden>
              <rect x="1" y="1" width="10" height="10" fill="#f25022" />
              <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
              <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
              <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
            </svg>
          )}
          Sign in with Microsoft
        </button>

        {error ? (
          <p className="mt-4 w-full text-center text-sm text-risk-critical">{error}</p>
        ) : null}

        <div className="mt-8 flex items-center gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          <span>Protected by Microsoft Entra ID</span>
        </div>
      </div>

      <p className="absolute bottom-6 text-center text-[11px] text-muted-foreground/70">
        MFA and conditional access are enforced by your directory.
      </p>
    </div>
  );
}
