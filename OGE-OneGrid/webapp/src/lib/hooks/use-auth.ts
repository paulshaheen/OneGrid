import { useEffect, useState } from "react";

import { auth, type AuthSession, type AuthUser } from "@/lib/auth/session";

export type TenantIdentity = {
  user: AuthUser | null;
  session: AuthSession | null;
  loading: boolean;
  /** Home tenant id when the user signed in with a directory identity. */
  tenantId: string | null;
  displayName: string;
  initials: string;
  provider: string;
};

function deriveName(user: AuthUser | null) {
  if (!user) return "";
  const meta = user.user_metadata ?? {};
  return (meta["full_name"] as string) || (meta["name"] as string) || user.email || "Signed in";
}

export function useAuth(): TenantIdentity {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    void auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const user = session?.user ?? null;
  const name = deriveName(user);
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const appMeta = (user?.app_metadata ?? {}) as Record<string, unknown>;

  return {
    user,
    session,
    loading,
    tenantId: (meta["tid"] as string) ?? (meta["tenant_id"] as string) ?? null,
    displayName: name,
    initials:
      name
        .split(/[\s@.]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("") || "?",
    provider: (appMeta["provider"] as string) ?? "local",
  };
}
