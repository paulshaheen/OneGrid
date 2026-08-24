import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.js";
import { HeadContent, Link, Outlet, Scripts, createFileRoute, createRootRouteWithContext, createRouter, lazyRouteComponent, redirect, useRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
//#region src/styles.css?url
var styles_default = "/assets/styles-B1rep56O.css";
//#endregion
//#region src/routes/__root.tsx
function NotFoundComponent() {
	return /* @__PURE__ */ jsx("div", {
		className: "flex min-h-screen items-center justify-center bg-background px-4",
		children: /* @__PURE__ */ jsxs("div", {
			className: "max-w-md text-center",
			children: [
				/* @__PURE__ */ jsx("h1", {
					className: "text-7xl font-bold text-foreground",
					children: "404"
				}),
				/* @__PURE__ */ jsx("h2", {
					className: "mt-4 text-xl font-semibold text-foreground",
					children: "Page not found"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-2 text-sm text-muted-foreground",
					children: "The page you're looking for doesn't exist or has been moved."
				}),
				/* @__PURE__ */ jsx("div", {
					className: "mt-6",
					children: /* @__PURE__ */ jsx(Link, {
						to: "/",
						className: "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
						children: "Go home"
					})
				})
			]
		})
	});
}
function ErrorComponent({ error, reset }) {
	console.error(error);
	const router = useRouter();
	return /* @__PURE__ */ jsx("div", {
		className: "flex min-h-screen items-center justify-center bg-background px-4",
		children: /* @__PURE__ */ jsxs("div", {
			className: "max-w-md text-center",
			children: [
				/* @__PURE__ */ jsx("h1", {
					className: "text-xl font-semibold tracking-tight text-foreground",
					children: "This page didn't load"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-2 text-sm text-muted-foreground",
					children: "Something went wrong on our end. You can try refreshing or head back home."
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mt-6 flex flex-wrap justify-center gap-2",
					children: [/* @__PURE__ */ jsx("button", {
						onClick: () => {
							router.invalidate();
							reset();
						},
						className: "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
						children: "Try again"
					}), /* @__PURE__ */ jsx("a", {
						href: "/",
						className: "inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent",
						children: "Go home"
					})]
				})
			]
		})
	});
}
var Route$25 = createRootRouteWithContext()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: "Weather & Asset Risk Operations" },
			{
				name: "description",
				content: "Enterprise weather and asset risk operations for oil & gas: hurricane exposure, asset risk scoring, alerts and an AI operations assistant."
			},
			{
				property: "og:title",
				content: "Weather & Asset Risk Operations"
			},
			{
				property: "og:description",
				content: "Hurricane and asset exposure intelligence for offshore and downstream energy operations."
			},
			{
				property: "og:type",
				content: "website"
			},
			{
				name: "twitter:card",
				content: "summary_large_image"
			}
		],
		links: [
			{
				rel: "stylesheet",
				href: styles_default
			},
			{
				rel: "icon",
				href: "/favicon.ico",
				type: "image/x-icon"
			},
			{
				rel: "preconnect",
				href: "https://fonts.googleapis.com"
			},
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous"
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
			}
		]
	}),
	shellComponent: RootShell,
	component: RootComponent,
	notFoundComponent: NotFoundComponent,
	errorComponent: ErrorComponent
});
function RootShell({ children }) {
	return /* @__PURE__ */ jsxs("html", {
		lang: "en",
		className: "dark",
		children: [/* @__PURE__ */ jsxs("head", { children: [/* @__PURE__ */ jsx(HeadContent, {}), /* @__PURE__ */ jsx(RuntimeConfigScript, {})] }), /* @__PURE__ */ jsxs("body", { children: [children, /* @__PURE__ */ jsx(Scripts, {})] })]
	});
}
/**
* Publishes the deployment's public Entra IDs to the browser at runtime so the
* SPA can sign in without a rebuild. Rendered on the server only; the client
* already has window.__APP_CONFIG__ from the server-rendered HTML. The client
* id and tenant id are public identifiers, not secrets.
*/
function RuntimeConfigScript() {
	if (typeof process === "undefined") return null;
	const config = {
		entraClientId: process.env["ENTRA_CLIENT_ID"] ?? "",
		entraTenantId: process.env["ENTRA_TENANT_ID"] ?? "",
		geoCatalogUrl: process.env["GEOCATALOG_URI"] ?? "",
		foundryEndpoint: process.env["FOUNDRY_ENDPOINT"] ?? "",
		foundryDeployment: process.env["FOUNDRY_DEPLOYMENT"] ?? ""
	};
	const json = JSON.stringify(config).replace(/</g, "\\u003c");
	return /* @__PURE__ */ jsx("script", { dangerouslySetInnerHTML: { __html: `window.__APP_CONFIG__=${json}` } });
}
function RootComponent() {
	const { queryClient } = Route$25.useRouteContext();
	return /* @__PURE__ */ jsx(QueryClientProvider, {
		client: queryClient,
		children: /* @__PURE__ */ jsx(Outlet, {})
	});
}
//#endregion
//#region src/routes/index.tsx
var Route$24 = createFileRoute("/")({ beforeLoad: () => {
	throw redirect({ to: "/app" });
} });
//#endregion
//#region src/routes/_authenticated/route.tsx
var $$splitComponentImporter$13 = () => import("./route-Di7iQBCH.js");
var Route$23 = createFileRoute("/_authenticated")({
	ssr: false,
	component: lazyRouteComponent($$splitComponentImporter$13, "component")
});
//#endregion
//#region src/routes/alerts.tsx
var Route$22 = createFileRoute("/alerts")({ beforeLoad: () => {
	throw redirect({ to: "/app/alerts" });
} });
//#endregion
//#region src/routes/assets.tsx
var Route$21 = createFileRoute("/assets")({ beforeLoad: () => {
	throw redirect({ to: "/app/assets" });
} });
//#endregion
//#region src/routes/auth.tsx
var $$splitComponentImporter$12 = () => import("./auth-CSzSDzZx.js");
var Route$20 = createFileRoute("/auth")({
	ssr: false,
	validateSearch: (search) => typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
	head: () => ({ meta: [
		{ title: "Sign in | Weather & Asset Risk" },
		{
			name: "description",
			content: "Sign in with Microsoft Entra ID to open your tenant's hurricane and asset risk operations console."
		},
		{
			property: "og:title",
			content: "Sign in | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "Microsoft Entra ID single sign-on for operations teams."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$12, "component")
});
//#endregion
//#region src/routes/copilot.tsx
var Route$19 = createFileRoute("/copilot")({ beforeLoad: () => {
	throw redirect({ to: "/app/copilot" });
} });
//#endregion
//#region src/routes/deployment.tsx
var Route$18 = createFileRoute("/deployment")({ beforeLoad: () => {
	throw redirect({ to: "/app/deployment" });
} });
//#endregion
//#region src/routes/events.tsx
var Route$17 = createFileRoute("/events")({ beforeLoad: () => {
	throw redirect({ to: "/app/events" });
} });
//#endregion
//#region src/routes/map.tsx
var Route$16 = createFileRoute("/map")({ beforeLoad: () => {
	throw redirect({ to: "/app/map" });
} });
//#endregion
//#region src/routes/posture.tsx
var Route$15 = createFileRoute("/posture")({ beforeLoad: () => {
	throw redirect({ to: "/app/posture" });
} });
//#endregion
//#region src/routes/risk.tsx
var Route$14 = createFileRoute("/risk")({ beforeLoad: () => {
	throw redirect({ to: "/app/risk" });
} });
//#endregion
//#region src/routes/thresholds.tsx
var Route$13 = createFileRoute("/thresholds")({ beforeLoad: () => {
	throw redirect({ to: "/app/thresholds" });
} });
//#endregion
//#region src/routes/timeline.tsx
var Route$12 = createFileRoute("/timeline")({ beforeLoad: () => {
	throw redirect({ to: "/app/timeline" });
} });
//#endregion
//#region src/routes/auth_.callback.tsx
var $$splitComponentImporter$11 = () => import("./auth_.callback-BGmsdNdy.js");
var Route$11 = createFileRoute("/auth_/callback")({
	ssr: false,
	head: () => ({ meta: [
		{ title: "Signing in | Weather & Asset Risk" },
		{
			name: "description",
			content: "Completing sign-in."
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$11, "component")
});
//#endregion
//#region src/routes/_authenticated/app.index.tsx
var $$splitComponentImporter$10 = () => import("./app.index-B30JDW-j.js");
var Route$10 = createFileRoute("/_authenticated/app/")({
	head: () => ({ meta: [
		{ title: "Operations Overview | Weather & Asset Risk" },
		{
			name: "description",
			content: "Executive view of Severe weather exposure across offshore platforms, pipelines, refineries and LNG terminals."
		},
		{
			property: "og:title",
			content: "Operations Overview | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "Executive view of Severe weather exposure across offshore platforms, pipelines, refineries and LNG terminals."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$10, "component")
});
//#endregion
//#region src/routes/_authenticated/app.alerts.tsx
var $$splitComponentImporter$9 = () => import("./app.alerts-DqJshQOZ.js");
var Route$9 = createFileRoute("/_authenticated/app/alerts")({
	head: () => ({ meta: [
		{ title: "Alerts | Weather & Asset Risk" },
		{
			name: "description",
			content: "Prioritised operational alerts from hazard exposure and threshold breaches."
		},
		{
			property: "og:title",
			content: "Alerts | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "Prioritised operational alerts from hazard exposure and threshold breaches."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$9, "component")
});
//#endregion
//#region src/routes/_authenticated/app.assets.tsx
var $$splitComponentImporter$8 = () => import("./app.assets-C57Ex5sT.js");
var Route$8 = createFileRoute("/_authenticated/app/assets")({
	head: () => ({ meta: [
		{ title: "Asset Management | Weather & Asset Risk" },
		{
			name: "description",
			content: "Registry of platforms, wells, pipelines, refineries, terminals and ports under monitoring."
		},
		{
			property: "og:title",
			content: "Asset Management | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "Registry of platforms, wells, pipelines, refineries, terminals and ports under monitoring."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$8, "component")
});
//#endregion
//#region src/routes/_authenticated/app.copilot.tsx
var $$splitComponentImporter$7 = () => import("./app.copilot-DZLv-CSC.js");
var Route$7 = createFileRoute("/_authenticated/app/copilot")({
	head: () => ({ meta: [
		{ title: "Operations Assistant | Weather & Asset Risk" },
		{
			name: "description",
			content: "Natural-language assistant grounded in live asset, storm and risk data."
		},
		{
			property: "og:title",
			content: "Operations Assistant | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "Natural-language assistant grounded in live asset, storm and risk data."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$7, "component")
});
//#endregion
//#region src/routes/_authenticated/app.deployment.tsx
var $$splitComponentImporter$6 = () => import("./app.deployment-MDXTiYX4.js");
var Route$6 = createFileRoute("/_authenticated/app/deployment")({
	head: () => ({ meta: [
		{ title: "Deployment | Weather & Asset Risk" },
		{
			name: "description",
			content: "Azure reference architecture and adapter configuration for tenant deployment."
		},
		{
			property: "og:title",
			content: "Deployment | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "Azure reference architecture and adapter configuration for tenant deployment."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$6, "component")
});
//#endregion
//#region src/routes/_authenticated/app.events.tsx
var $$splitComponentImporter$5 = () => import("./app.events-HMNt6xwP.js");
var Route$5 = createFileRoute("/_authenticated/app/events")({
	head: () => ({ meta: [
		{ title: "Weather Events | Weather & Asset Risk" },
		{
			name: "description",
			content: "Active and monitored tropical systems with intensity, motion and forecast confidence."
		},
		{
			property: "og:title",
			content: "Weather Events | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "Active and monitored tropical systems with intensity, motion and forecast confidence."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$5, "component")
});
//#endregion
//#region src/routes/_authenticated/app.map.tsx
var $$splitComponentImporter$4 = () => import("./app.map-B9SpCn6R.js");
var Route$4 = createFileRoute("/_authenticated/app/map")({
	head: () => ({ meta: [
		{ title: "Live Map | Weather & Asset Risk" },
		{
			name: "description",
			content: "Interactive operations map with hurricane track, forecast cone, wind field and asset exposure layers."
		},
		{
			property: "og:title",
			content: "Live Map | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "Interactive operations map with hurricane track, forecast cone, wind field and asset exposure layers."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$4, "component")
});
//#endregion
//#region src/routes/_authenticated/app.posture.tsx
var $$splitComponentImporter$3 = () => import("./app.posture-Dg_S2MQ2.js");
var Route$3 = createFileRoute("/_authenticated/app/posture")({
	head: () => ({ meta: [
		{ title: "Response Posture | Weather & Asset Risk" },
		{
			name: "description",
			content: "T-gate board tracking watch, logistics, down-manning, shut-in and evacuation status by asset."
		},
		{
			property: "og:title",
			content: "Response Posture | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "T-gate board tracking watch, logistics, down-manning, shut-in and evacuation status by asset."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$3, "component")
});
//#endregion
//#region src/routes/_authenticated/app.risk.tsx
var $$splitComponentImporter$2 = () => import("./app.risk-VHe-h0hk.js");
var Route$2 = createFileRoute("/_authenticated/app/risk")({
	head: () => ({ meta: [
		{ title: "Asset Risk | Weather & Asset Risk" },
		{
			name: "description",
			content: "Ranked infrastructure exposure with transparent risk scoring, impact ETA and primary threat by asset."
		},
		{
			property: "og:title",
			content: "Asset Risk | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "Ranked infrastructure exposure with transparent risk scoring, impact ETA and primary threat by asset."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$2, "component")
});
//#endregion
//#region src/routes/_authenticated/app.thresholds.tsx
var $$splitComponentImporter$1 = () => import("./app.thresholds-BK8DjqFF.js");
var Route$1 = createFileRoute("/_authenticated/app/thresholds")({
	head: () => ({ meta: [
		{ title: "Thresholds | Weather & Asset Risk" },
		{
			name: "description",
			content: "Configurable operational limits per asset class that drive automated alerting."
		},
		{
			property: "og:title",
			content: "Thresholds | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "Configurable operational limits per asset class that drive automated alerting."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
//#endregion
//#region src/routes/_authenticated/app.timeline.tsx
var $$splitComponentImporter = () => import("./app.timeline-BQPKiO6F.js");
var Route = createFileRoute("/_authenticated/app/timeline")({
	head: () => ({ meta: [
		{ title: "Forecast Timeline | Weather & Asset Risk" },
		{
			name: "description",
			content: "120-hour forecast scrubbing showing how storm position and asset exposure evolve."
		},
		{
			property: "og:title",
			content: "Forecast Timeline | Weather & Asset Risk"
		},
		{
			property: "og:description",
			content: "120-hour forecast scrubbing showing how storm position and asset exposure evolve."
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary_large_image"
		},
		{
			name: "robots",
			content: "noindex"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
//#region src/routeTree.gen.ts
var IndexRoute = Route$24.update({
	id: "/",
	path: "/",
	getParentRoute: () => Route$25
});
var AuthenticatedRouteRoute = Route$23.update({
	id: "/_authenticated",
	getParentRoute: () => Route$25
});
var AlertsRoute = Route$22.update({
	id: "/alerts",
	path: "/alerts",
	getParentRoute: () => Route$25
});
var AssetsRoute = Route$21.update({
	id: "/assets",
	path: "/assets",
	getParentRoute: () => Route$25
});
var AuthRoute = Route$20.update({
	id: "/auth",
	path: "/auth",
	getParentRoute: () => Route$25
});
var CopilotRoute = Route$19.update({
	id: "/copilot",
	path: "/copilot",
	getParentRoute: () => Route$25
});
var DeploymentRoute = Route$18.update({
	id: "/deployment",
	path: "/deployment",
	getParentRoute: () => Route$25
});
var EventsRoute = Route$17.update({
	id: "/events",
	path: "/events",
	getParentRoute: () => Route$25
});
var MapRoute = Route$16.update({
	id: "/map",
	path: "/map",
	getParentRoute: () => Route$25
});
var PostureRoute = Route$15.update({
	id: "/posture",
	path: "/posture",
	getParentRoute: () => Route$25
});
var RiskRoute = Route$14.update({
	id: "/risk",
	path: "/risk",
	getParentRoute: () => Route$25
});
var ThresholdsRoute = Route$13.update({
	id: "/thresholds",
	path: "/thresholds",
	getParentRoute: () => Route$25
});
var TimelineRoute = Route$12.update({
	id: "/timeline",
	path: "/timeline",
	getParentRoute: () => Route$25
});
var AuthCallbackRoute = Route$11.update({
	id: "/auth_/callback",
	path: "/auth/callback",
	getParentRoute: () => Route$25
});
var AuthenticatedAppIndexRoute = Route$10.update({
	id: "/app/",
	path: "/app/",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedRouteRouteChildren = {
	AuthenticatedAppAlertsRoute: Route$9.update({
		id: "/app/alerts",
		path: "/app/alerts",
		getParentRoute: () => AuthenticatedRouteRoute
	}),
	AuthenticatedAppAssetsRoute: Route$8.update({
		id: "/app/assets",
		path: "/app/assets",
		getParentRoute: () => AuthenticatedRouteRoute
	}),
	AuthenticatedAppCopilotRoute: Route$7.update({
		id: "/app/copilot",
		path: "/app/copilot",
		getParentRoute: () => AuthenticatedRouteRoute
	}),
	AuthenticatedAppDeploymentRoute: Route$6.update({
		id: "/app/deployment",
		path: "/app/deployment",
		getParentRoute: () => AuthenticatedRouteRoute
	}),
	AuthenticatedAppEventsRoute: Route$5.update({
		id: "/app/events",
		path: "/app/events",
		getParentRoute: () => AuthenticatedRouteRoute
	}),
	AuthenticatedAppMapRoute: Route$4.update({
		id: "/app/map",
		path: "/app/map",
		getParentRoute: () => AuthenticatedRouteRoute
	}),
	AuthenticatedAppPostureRoute: Route$3.update({
		id: "/app/posture",
		path: "/app/posture",
		getParentRoute: () => AuthenticatedRouteRoute
	}),
	AuthenticatedAppRiskRoute: Route$2.update({
		id: "/app/risk",
		path: "/app/risk",
		getParentRoute: () => AuthenticatedRouteRoute
	}),
	AuthenticatedAppThresholdsRoute: Route$1.update({
		id: "/app/thresholds",
		path: "/app/thresholds",
		getParentRoute: () => AuthenticatedRouteRoute
	}),
	AuthenticatedAppTimelineRoute: Route.update({
		id: "/app/timeline",
		path: "/app/timeline",
		getParentRoute: () => AuthenticatedRouteRoute
	}),
	AuthenticatedAppIndexRoute
};
var rootRouteChildren = {
	IndexRoute,
	AuthenticatedRouteRoute: AuthenticatedRouteRoute._addFileChildren(AuthenticatedRouteRouteChildren),
	AlertsRoute,
	AssetsRoute,
	AuthRoute,
	CopilotRoute,
	DeploymentRoute,
	EventsRoute,
	MapRoute,
	PostureRoute,
	RiskRoute,
	ThresholdsRoute,
	TimelineRoute,
	AuthCallbackRoute
};
var routeTree = Route$25._addFileChildren(rootRouteChildren)._addFileTypes();
//#endregion
//#region src/router.tsx
var router_exports = /* @__PURE__ */ __exportAll({ getRouter: () => getRouter });
var getRouter = () => {
	const queryClient = new QueryClient();
	return createRouter({
		routeTree,
		context: { queryClient },
		scrollRestoration: true,
		defaultPreloadStaleTime: 0
	});
};
//#endregion
export { getRouter, Route$20 as n, router_exports as t };
