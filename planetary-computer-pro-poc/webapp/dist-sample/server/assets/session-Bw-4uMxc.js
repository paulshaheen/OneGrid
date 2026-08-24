import { EventType, PublicClientApplication } from "@azure/msal-browser";
//#region src/lib/auth/config.ts
function getEntraConfig() {
	const runtime = typeof window !== "undefined" ? window.__APP_CONFIG__ : void 0;
	const clientId = runtime?.entraClientId || {
		"BASE_URL": "/",
		"DEV": false,
		"MODE": "production",
		"PROD": true,
		"SSR": true,
		"TSS_DEV_SERVER": "false",
		"TSS_DEV_SSR_STYLES_BASEPATH": "/",
		"TSS_DEV_SSR_STYLES_ENABLED": "true",
		"TSS_DISABLE_CSRF_MIDDLEWARE_WARNING": "false",
		"TSS_INLINE_CSS_ENABLED": "false",
		"TSS_ROUTER_BASEPATH": "",
		"TSS_SERVER_FN_BASE": "/_serverFn/",
		"VITE_USE_SAMPLE_DATA": "true"
	}["VITE_ENTRA_CLIENT_ID"] || "";
	const tenantId = runtime?.entraTenantId || {
		"BASE_URL": "/",
		"DEV": false,
		"MODE": "production",
		"PROD": true,
		"SSR": true,
		"TSS_DEV_SERVER": "false",
		"TSS_DEV_SSR_STYLES_BASEPATH": "/",
		"TSS_DEV_SSR_STYLES_ENABLED": "true",
		"TSS_DISABLE_CSRF_MIDDLEWARE_WARNING": "false",
		"TSS_INLINE_CSS_ENABLED": "false",
		"TSS_ROUTER_BASEPATH": "",
		"TSS_SERVER_FN_BASE": "/_serverFn/",
		"VITE_USE_SAMPLE_DATA": "true"
	}["VITE_ENTRA_TENANT_ID"] || "";
	if (!clientId || !tenantId) return null;
	return {
		clientId,
		tenantId
	};
}
//#endregion
//#region src/lib/auth/session.ts
var LOGIN_SCOPES = [
	"openid",
	"profile",
	"email"
];
var instance = null;
var initPromise = null;
/** Lazily construct the MSAL app in the browser once configuration exists. */
function getInstance() {
	if (typeof window === "undefined") return null;
	if (instance) return instance;
	const config = getEntraConfig();
	if (!config) return null;
	instance = new PublicClientApplication({
		auth: {
			clientId: config.clientId,
			authority: `https://login.microsoftonline.com/${config.tenantId}`,
			redirectUri: `${window.location.origin}/auth/callback`,
			postLogoutRedirectUri: `${window.location.origin}/`
		},
		cache: {
			cacheLocation: "localStorage",
			storeAuthStateInCookie: false
		}
	});
	return instance;
}
/** Initialize MSAL and process any redirect result exactly once. */
async function ensureReady() {
	const app = getInstance();
	if (!app) return null;
	if (!initPromise) initPromise = (async () => {
		await app.initialize();
		const result = await app.handleRedirectPromise();
		if (result?.account) app.setActiveAccount(result.account);
		else if (!app.getActiveAccount()) {
			const [existing] = app.getAllAccounts();
			if (existing) app.setActiveAccount(existing);
		}
		return app;
	})();
	return initPromise;
}
function activeAccount(app) {
	return app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null;
}
function toUser(account) {
	const name = (account.idTokenClaims ?? {})["name"] || account.name || account.username || "Signed in";
	return {
		id: account.localAccountId,
		email: account.username,
		user_metadata: {
			full_name: name,
			name,
			tid: account.tenantId
		},
		app_metadata: { provider: "azure" }
	};
}
function toSession(account) {
	return account ? { user: toUser(account) } : null;
}
var auth = {
	/** Whether Entra ID is configured for this deployment. */
	isConfigured() {
		return getEntraConfig() !== null;
	},
	async getSession() {
		const app = await ensureReady();
		if (!app) return { data: { session: null } };
		return { data: { session: toSession(activeAccount(app)) } };
	},
	onAuthStateChange(callback) {
		const app = getInstance();
		if (!app) return { data: { subscription: { unsubscribe: () => {} } } };
		ensureReady();
		const callbackId = app.addEventCallback((message) => {
			switch (message.eventType) {
				case EventType.LOGIN_SUCCESS:
				case EventType.ACQUIRE_TOKEN_SUCCESS:
				case EventType.HANDLE_REDIRECT_END: {
					const account = activeAccount(app);
					callback(account ? "SIGNED_IN" : "SIGNED_OUT", toSession(account));
					break;
				}
				case EventType.LOGOUT_SUCCESS: callback("SIGNED_OUT", null);
			}
		});
		return { data: { subscription: { unsubscribe: () => {
			if (callbackId) app.removeEventCallback(callbackId);
		} } } };
	},
	async signInWithEntra() {
		const app = await ensureReady();
		if (!app) return { error: { message: "Microsoft Entra ID is not configured for this deployment. Set ENTRA_CLIENT_ID and ENTRA_TENANT_ID." } };
		await app.loginRedirect({ scopes: LOGIN_SCOPES });
		return { error: null };
	},
	async signOut() {
		const app = await ensureReady();
		if (!app) return;
		await app.logoutRedirect({ account: activeAccount(app) ?? void 0 });
	}
};
//#endregion
export { auth as t };
