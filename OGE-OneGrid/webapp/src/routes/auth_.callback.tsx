import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { auth } from "@/lib/auth/session";

export const Route = createFileRoute("/auth_/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing in | Weather & Asset Risk" },
      { name: "description", content: "Completing sign-in." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CallbackPage,
});

function CallbackPage() {
  const [message, setMessage] = useState("Completing sign-in…");

  useEffect(() => {
    let cancelled = false;
    const finish = (session: unknown) => {
      if (cancelled) return;
      if (!session) return;
      const stored = sessionStorage.getItem("post-auth-path");
      sessionStorage.removeItem("post-auth-path");
      window.location.replace(stored && stored.startsWith("/") ? stored : "/app");
    };

    const { data: sub } = auth.onAuthStateChange((_e, session) => finish(session));
    void auth.getSession().then(({ data }) => {
      if (data.session) finish(data.session);
      else
        setTimeout(() => {
          if (!cancelled)
            setMessage("Sign-in did not complete. Return to the sign-in page and try again.");
        }, 6000);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {message}
      </div>
    </div>
  );
}
