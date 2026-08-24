// Entra ID (Microsoft identity platform) configuration.
//
// The client (application) ID and tenant (directory) ID are *public*
// identifiers, not secrets, so they are safe to expose to the browser. They
// reach the SPA one of two ways:
//   1. Runtime — the SSR shell injects `window.__APP_CONFIG__` from the App
//      Service settings ENTRA_CLIENT_ID / ENTRA_TENANT_ID (no rebuild needed).
//   2. Build time — VITE_ENTRA_CLIENT_ID / VITE_ENTRA_TENANT_ID for local dev.
//
// When neither is set, sign-in is treated as "not configured" and the UI says
// so instead of pretending to authenticate.

export type EntraConfig = {
  clientId: string;
  tenantId: string;
};

type RuntimeConfig = {
  entraClientId?: string;
  entraTenantId?: string;
};

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeConfig;
  }
}

export function getEntraConfig(): EntraConfig | null {
  const runtime = typeof window !== "undefined" ? window.__APP_CONFIG__ : undefined;

  const clientId =
    runtime?.entraClientId || (import.meta.env["VITE_ENTRA_CLIENT_ID"] as string | undefined) || "";
  const tenantId =
    runtime?.entraTenantId || (import.meta.env["VITE_ENTRA_TENANT_ID"] as string | undefined) || "";

  if (!clientId || !tenantId) return null;
  return { clientId, tenantId };
}

export function isEntraConfigured(): boolean {
  return getEntraConfig() !== null;
}
