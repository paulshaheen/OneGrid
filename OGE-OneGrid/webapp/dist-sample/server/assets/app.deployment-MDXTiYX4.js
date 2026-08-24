import { C as OpsLink, S as PageHeader, a as layersQuery, d as getDataPlaneStatus, w as useOpsBase, x as AppShell } from "./use-ops-data-B8Zw8Vry.js";
import { jsx, jsxs } from "react/jsx-runtime";
import { Boxes, Check, CloudSun, Database, ExternalLink, Shield, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
//#region src/lib/services/azure-config.ts
/** Reads a config value consistently on both server (process.env) and client (injected window). */
function read(runtimeKey, envKey, viteKey) {
	const runtime = typeof window !== "undefined" ? window.__APP_CONFIG__?.[runtimeKey] : void 0;
	if (typeof runtime === "string" && runtime) return runtime;
	if (typeof process !== "undefined" && process.env?.[envKey]) return process.env[envKey];
	return {
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
	}[viteKey] ?? "";
}
function getServiceConfig() {
	return {
		geoCatalogUrl: read("geoCatalogUrl", "GEOCATALOG_URI", "VITE_GEOCATALOG_URL"),
		foundryEndpoint: read("foundryEndpoint", "FOUNDRY_ENDPOINT", "VITE_FOUNDRY_ENDPOINT"),
		foundryDeployment: read("foundryDeployment", "FOUNDRY_DEPLOYMENT", "VITE_FOUNDRY_DEPLOYMENT")
	};
}
//#endregion
//#region src/views/deployment.tsx
function hostOf(url) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}
var ROLES = [
	["Viewer", "Read-only access to dashboards, map and alerts"],
	["Operator", "Acknowledge and resolve alerts, adjust thresholds for owned assets"],
	["Analyst", "Configure risk weightings, forecast providers and reporting"],
	["Administrator", "Manage tenancy, data connections, roles and deployment settings"]
];
var SECURITY = [
	"Microsoft Entra sign-in with your directory's MFA and conditional access",
	"Managed identity for service-to-service access — no keys in the app or source",
	"Data-plane roles (GeoCatalog, Storage, AI) assigned to the app identity at deploy time",
	"Non-secret configuration published at runtime; secrets never reach the browser"
];
function DeploymentPage() {
	const base = useOpsBase();
	const cfg = getServiceConfig();
	const status = useQuery({
		queryKey: [base, "data-plane-status"],
		queryFn: () => getDataPlaneStatus(),
		staleTime: 3e5
	});
	const layers = useQuery(layersQuery(base));
	const geoCatalogWired = Boolean(cfg.geoCatalogUrl);
	const foundryWired = Boolean(cfg.foundryEndpoint);
	const uploadWired = status.data?.uploadConfigured ?? false;
	const auroraEndpointWired = status.data?.auroraEndpointConfigured ?? false;
	const auroraModelDeployed = status.data?.auroraModelDeployed ?? false;
	const auroraAdapterConnected = status.data?.auroraAdapterConnected ?? false;
	const services = [
		{
			name: "Geospatial catalog (Planetary Computer Pro)",
			detail: "STAC collections and imagery for the operating region",
			wired: geoCatalogWired,
			endpoint: cfg.geoCatalogUrl ? hostOf(cfg.geoCatalogUrl) : void 0
		},
		{
			name: "AI operations assistant (Azure OpenAI)",
			detail: cfg.foundryDeployment ? `Deployment: ${cfg.foundryDeployment}` : "Grounded natural-language answers",
			wired: foundryWired,
			endpoint: cfg.foundryEndpoint ? hostOf(cfg.foundryEndpoint) : void 0
		},
		{
			name: "Data storage & upload",
			detail: "Blob container for uploaded assets and catalog ingestion sources",
			wired: uploadWired
		},
		{
			name: "Aurora weather inference",
			detail: !auroraEndpointWired ? "Select Aurora and provide its model asset ID in the Azure deployment form" : !auroraModelDeployed ? "Azure ML endpoint provisioned; GPU model deployment still required" : "Aurora model deployed; WeatherEvent response adapter still required",
			wired: auroraModelDeployed && auroraAdapterConnected,
			statusLabel: !auroraEndpointWired ? "Not configured" : auroraModelDeployed ? "Adapter required" : "Model required"
		}
	];
	return /* @__PURE__ */ jsxs(AppShell, { children: [/* @__PURE__ */ jsx(PageHeader, {
		title: "Deployment",
		description: "Infrastructure is provisioned by the deployment template using your Azure credentials. This page reports what is wired to this deployment — it does not provision resources."
	}), /* @__PURE__ */ jsxs("div", {
		className: "grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "space-y-4",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "panel",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-center justify-between border-b px-4 py-2.5",
						children: [/* @__PURE__ */ jsx("span", {
							className: "label-xs",
							children: "Connected Azure services"
						}), status.isLoading && /* @__PURE__ */ jsx("span", {
							className: "text-[11px] text-muted-foreground",
							children: "Checking…"
						})]
					}), /* @__PURE__ */ jsx("ul", {
						className: "divide-y",
						children: services.map((s) => /* @__PURE__ */ jsxs("li", {
							className: "flex items-start justify-between gap-4 px-4 py-3",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "min-w-0",
								children: [
									/* @__PURE__ */ jsx("div", {
										className: "text-xs font-medium",
										children: s.name
									}),
									/* @__PURE__ */ jsx("div", {
										className: "text-[11px] text-muted-foreground",
										children: s.detail
									}),
									s.endpoint && /* @__PURE__ */ jsx("div", {
										className: "num mt-0.5 truncate text-[10px] text-muted-foreground/80",
										children: s.endpoint
									})
								]
							}), /* @__PURE__ */ jsxs("span", {
								className: `mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-medium ${s.wired ? "border-risk-normal/50 bg-risk-normal/10 text-risk-normal" : "border-border text-muted-foreground"}`,
								children: [/* @__PURE__ */ jsx("span", { className: `size-1.5 rounded-full ${s.wired ? "bg-risk-normal" : "bg-muted-foreground/50"}` }), s.statusLabel ?? (s.wired ? "Connected" : "Not configured")]
							})]
						}, s.name))
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "panel p-4",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "label-xs mb-2 flex items-center gap-1.5",
							children: [/* @__PURE__ */ jsx(Database, { className: "size-3.5 text-primary" }), " Catalog contents"]
						}),
						/* @__PURE__ */ jsxs("p", {
							className: "text-[11px] leading-relaxed text-muted-foreground",
							children: [
								"This deployment currently exposes",
								" ",
								/* @__PURE__ */ jsx("span", {
									className: "num font-medium text-foreground",
									children: layers.data?.length ?? 0
								}),
								" ",
								"geospatial ",
								layers.data?.length === 1 ? "collection" : "collections",
								". Assets are ingested from your GIS or uploaded — nothing is pre-populated."
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "mt-3 flex flex-wrap gap-2",
							children: [/* @__PURE__ */ jsxs(OpsLink, {
								to: "/assets",
								className: "inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15",
								children: [/* @__PURE__ */ jsx(Database, { className: "size-3.5" }), " Add data"]
							}), /* @__PURE__ */ jsxs(OpsLink, {
								to: "/",
								className: "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] hover:bg-accent",
								children: [/* @__PURE__ */ jsx(Sparkles, { className: "size-3.5" }), " Load a public sample"]
							})]
						})
					]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "panel p-4",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "label-xs mb-2 flex items-center gap-1.5",
						children: [/* @__PURE__ */ jsx(Boxes, { className: "size-3.5 text-primary" }), " Service adapters"]
					}), /* @__PURE__ */ jsx("p", {
						className: "text-[11px] leading-relaxed text-muted-foreground",
						children: "Assets, weather, events, risk, geospatial, alerts and the assistant are served through stable interfaces backed by the tenant's Azure resources. Each returns an honest empty result until the corresponding data is ingested — the app never falls back to synthetic sample data."
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "panel p-4",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "label-xs mb-2 flex items-center gap-1.5",
							children: [/* @__PURE__ */ jsx(CloudSun, { className: "size-3.5 text-primary" }), " Aurora configuration"]
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-[11px] leading-relaxed text-muted-foreground",
							children: "Configure Aurora in the Azure deployment form, not in this browser. Select the Aurora component, choose the GPU instance type, and provide the model asset ID. Bicep derives the scoring URI and stores it as a server-only app setting. No endpoint token or key is sent to the browser."
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "mt-2 rounded-sm border bg-card px-3 py-2 text-[10px] text-muted-foreground",
							children: [
								"Model asset example:",
								" ",
								/* @__PURE__ */ jsx("code", {
									className: "text-foreground",
									children: "azureml://registries/azureml/models/Aurora/versions/4"
								})
							]
						})
					]
				})
			]
		}), /* @__PURE__ */ jsxs("div", {
			className: "space-y-4",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "panel p-4",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "label-xs mb-2 flex items-center gap-1.5",
						children: [/* @__PURE__ */ jsx(Shield, { className: "size-3.5 text-primary" }), " Security posture"]
					}), /* @__PURE__ */ jsx("ul", {
						className: "space-y-1.5 text-[11px] text-muted-foreground",
						children: SECURITY.map((t) => /* @__PURE__ */ jsxs("li", {
							className: "flex gap-2",
							children: [/* @__PURE__ */ jsx(Check, { className: "mt-0.5 size-3 shrink-0 text-primary" }), t]
						}, t))
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "panel",
					children: [/* @__PURE__ */ jsx("div", {
						className: "border-b px-4 py-2.5 label-xs",
						children: "Roles"
					}), /* @__PURE__ */ jsx("ul", {
						className: "divide-y",
						children: ROLES.map(([r, d]) => /* @__PURE__ */ jsxs("li", {
							className: "px-4 py-2.5",
							children: [/* @__PURE__ */ jsx("div", {
								className: "text-xs font-medium",
								children: r
							}), /* @__PURE__ */ jsx("div", {
								className: "text-[11px] text-muted-foreground",
								children: d
							})]
						}, r))
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "panel p-4",
					children: [
						/* @__PURE__ */ jsx("div", {
							className: "label-xs mb-2",
							children: "Provisioning"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-[11px] leading-relaxed text-muted-foreground",
							children: "Resources are created by the deployment template (Bicep/ARM) under your subscription, with the app's managed identity granted the data-plane roles above. To change what is deployed, redeploy the template — application code ships unchanged."
						}),
						/* @__PURE__ */ jsxs("a", {
							href: "https://learn.microsoft.com/azure/planetary-computer/",
							target: "_blank",
							rel: "noreferrer",
							className: "mt-2 inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline",
							children: ["Planetary Computer Pro documentation ", /* @__PURE__ */ jsx(ExternalLink, { className: "size-3" })]
						})
					]
				})
			]
		})]
	})] });
}
//#endregion
//#region src/routes/_authenticated/app.deployment.tsx?tsr-split=component
var SplitComponent = DeploymentPage;
//#endregion
export { SplitComponent as component };
