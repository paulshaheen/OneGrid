// Azure service configuration for the PRODUCT app.
//
// A tenant deployment (main.bicep) sets these as App Service settings and the
// SSR shell injects the non-secret ones onto window.__APP_CONFIG__ (same pattern
// as the Entra config). When the GeoCatalog URL is present the app is a real
// deployment and the service registry binds the Azure-backed providers; when it
// is absent (the public marketing demo, or local dev) the registry falls back to
// the synthetic sample providers.
//
// Only non-secret identifiers live here. Tokens are never in the browser — the
// server functions acquire Managed Identity tokens server-side.

export type ServiceConfig = {
  /** Planetary Computer Pro GeoCatalog data-plane URL, e.g. https://<name>.<region>.geocatalog.spatio.azure.com */
  geoCatalogUrl: string;
  /** Azure OpenAI (Foundry) endpoint, e.g. https://<name>.openai.azure.com */
  foundryEndpoint: string;
  /** Chat deployment name on the Foundry endpoint, e.g. gpt-5-mini */
  foundryDeployment: string;
};

type RuntimeConfig = {
  geoCatalogUrl?: string;
  foundryEndpoint?: string;
  foundryDeployment?: string;
};

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeConfig & Record<string, unknown>;
  }
}

/** Reads a config value consistently on both server (process.env) and client (injected window). */
function read(runtimeKey: keyof RuntimeConfig, envKey: string, viteKey: string): string {
  const runtime = typeof window !== "undefined" ? window.__APP_CONFIG__?.[runtimeKey] : undefined;
  if (typeof runtime === "string" && runtime) return runtime;
  if (typeof process !== "undefined" && process.env?.[envKey]) return process.env[envKey] as string;
  const vite = (import.meta.env as Record<string, string | undefined>)[viteKey];
  return vite ?? "";
}

export function getServiceConfig(): ServiceConfig {
  return {
    geoCatalogUrl: read("geoCatalogUrl", "GEOCATALOG_URI", "VITE_GEOCATALOG_URL"),
    foundryEndpoint: read("foundryEndpoint", "FOUNDRY_ENDPOINT", "VITE_FOUNDRY_ENDPOINT"),
    foundryDeployment: read("foundryDeployment", "FOUNDRY_DEPLOYMENT", "VITE_FOUNDRY_DEPLOYMENT"),
  };
}

/**
 * True when this is a real tenant deployment (a GeoCatalog is wired up). The
 * registry uses this to decide Azure-backed vs synthetic providers, so a
 * deployed app never silently serves the sample Hurricane Gabrielle estate.
 */
export function isAzureConfigured(): boolean {
  return getServiceConfig().geoCatalogUrl !== "";
}
