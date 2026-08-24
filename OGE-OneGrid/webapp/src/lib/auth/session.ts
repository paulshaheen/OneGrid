// Microsoft Entra ID session, backed by MSAL (@azure/msal-browser).
//
// This is real identity: sign-in redirects to the Microsoft identity platform
// (OAuth 2.0 authorization code flow with PKCE) and sign-out ends the MSAL
// session. The surrounding app talks to this module through a small,
// provider-agnostic API (getSession / onAuthStateChange / signInWithEntra /
// signOut) so the console never touches MSAL directly.
//
// Configuration (client id + tenant id) comes from getEntraConfig(), which
// reads the App Service runtime settings or local VITE_ env. When it is
// absent, this module reports "not configured" instead of faking a session.

import {
  EventType,
  PublicClientApplication,
  type AccountInfo,
  type EventMessage,
} from "@azure/msal-browser";

import { getEntraConfig } from "./config";

export type AuthUser = {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
};

export type AuthSession = {
  user: AuthUser;
};

export type AuthChangeEvent = "SIGNED_IN" | "SIGNED_OUT";

type Listener = (event: AuthChangeEvent, session: AuthSession | null) => void;

const LOGIN_SCOPES = ["openid", "profile", "email"];

let instance: PublicClientApplication | null = null;
let initPromise: Promise<PublicClientApplication | null> | null = null;

/** Lazily construct the MSAL app in the browser once configuration exists. */
function getInstance(): PublicClientApplication | null {
  if (typeof window === "undefined") return null;
  if (instance) return instance;

  const config = getEntraConfig();
  if (!config) return null;

  instance = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: `${window.location.origin}/auth/callback`,
      postLogoutRedirectUri: `${window.location.origin}/`,
    },
    cache: {
      cacheLocation: "localStorage",
      storeAuthStateInCookie: false,
    },
  });

  return instance;
}

/** Initialize MSAL and process any redirect result exactly once. */
async function ensureReady(): Promise<PublicClientApplication | null> {
  const app = getInstance();
  if (!app) return null;

  if (!initPromise) {
    initPromise = (async () => {
      await app.initialize();
      const result = await app.handleRedirectPromise();
      if (result?.account) {
        app.setActiveAccount(result.account);
      } else if (!app.getActiveAccount()) {
        const [existing] = app.getAllAccounts();
        if (existing) app.setActiveAccount(existing);
      }
      return app;
    })();
  }

  return initPromise;
}

function activeAccount(app: PublicClientApplication): AccountInfo | null {
  return app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null;
}

function toUser(account: AccountInfo): AuthUser {
  const claims = (account.idTokenClaims ?? {}) as Record<string, unknown>;
  const name = (claims["name"] as string) || account.name || account.username || "Signed in";
  return {
    id: account.localAccountId,
    email: account.username,
    user_metadata: {
      full_name: name,
      name,
      tid: account.tenantId,
    },
    app_metadata: { provider: "azure" },
  };
}

function toSession(account: AccountInfo | null): AuthSession | null {
  return account ? { user: toUser(account) } : null;
}

export const auth = {
  /** Whether Entra ID is configured for this deployment. */
  isConfigured(): boolean {
    return getEntraConfig() !== null;
  },

  async getSession(): Promise<{ data: { session: AuthSession | null } }> {
    const app = await ensureReady();
    if (!app) return { data: { session: null } };
    return { data: { session: toSession(activeAccount(app)) } };
  },

  onAuthStateChange(callback: Listener): {
    data: { subscription: { unsubscribe: () => void } };
  } {
    const app = getInstance();
    if (!app) {
      return { data: { subscription: { unsubscribe: () => {} } } };
    }

    // Ensure init + redirect handling runs so the first event fires.
    void ensureReady();

    const callbackId = app.addEventCallback((message: EventMessage) => {
      switch (message.eventType) {
        case EventType.LOGIN_SUCCESS:
        case EventType.ACQUIRE_TOKEN_SUCCESS:
        case EventType.HANDLE_REDIRECT_END: {
          const account = activeAccount(app);
          callback(account ? "SIGNED_IN" : "SIGNED_OUT", toSession(account));
          break;
        }
        case EventType.LOGOUT_SUCCESS:
          callback("SIGNED_OUT", null);
          break;
        default:
          break;
      }
    });

    return {
      data: {
        subscription: {
          unsubscribe: () => {
            if (callbackId) app.removeEventCallback(callbackId);
          },
        },
      },
    };
  },

  async signInWithEntra(): Promise<{ error: { message: string } | null }> {
    const app = await ensureReady();
    if (!app) {
      return {
        error: {
          message:
            "Microsoft Entra ID is not configured for this deployment. Set ENTRA_CLIENT_ID and ENTRA_TENANT_ID.",
        },
      };
    }
    // Full-page redirect to the Microsoft identity platform. Control returns to
    // /auth/callback, where handleRedirectPromise (in ensureReady) completes it.
    await app.loginRedirect({ scopes: LOGIN_SCOPES });
    return { error: null };
  },

  async signOut(): Promise<void> {
    const app = await ensureReady();
    if (!app) return;
    await app.logoutRedirect({ account: activeAccount(app) ?? undefined });
  },
};
