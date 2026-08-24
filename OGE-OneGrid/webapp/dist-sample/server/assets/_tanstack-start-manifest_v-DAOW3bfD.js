//#region \0tanstack-start-manifest:v
var tsrStartManifest = () => ({ routes: {
	__root__: {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/__root.tsx",
		children: [
			"/",
			"/_authenticated",
			"/alerts",
			"/assets",
			"/auth",
			"/copilot",
			"/deployment",
			"/events",
			"/map",
			"/posture",
			"/risk",
			"/thresholds",
			"/timeline",
			"/auth_/callback"
		],
		preloads: ["/assets/index-iYfYO2tF.js", "/assets/jsx-runtime-Cltr0gcK.js"],
		scripts: [{ attrs: {
			type: "module",
			async: !0,
			src: "/assets/index-iYfYO2tF.js"
		} }]
	},
	"/_authenticated": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/route.tsx",
		children: [
			"/_authenticated/app/alerts",
			"/_authenticated/app/assets",
			"/_authenticated/app/copilot",
			"/_authenticated/app/deployment",
			"/_authenticated/app/events",
			"/_authenticated/app/map",
			"/_authenticated/app/posture",
			"/_authenticated/app/risk",
			"/_authenticated/app/thresholds",
			"/_authenticated/app/timeline",
			"/_authenticated/app/"
		],
		preloads: ["/assets/route-C3I2bcow.js"]
	},
	"/auth": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/auth.tsx",
		children: void 0,
		preloads: [
			"/assets/auth-B2rIwDP4.js",
			"/assets/createLucideIcon-CEGepnBf.js",
			"/assets/loader-circle-LmZjNfAe.js",
			"/assets/wind-Bu6EgeVR.js",
			"/assets/session-BAtJOxvx.js"
		]
	},
	"/auth_/callback": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/auth_.callback.tsx",
		children: void 0,
		preloads: [
			"/assets/auth_.callback-gVlKI0Kg.js",
			"/assets/loader-circle-LmZjNfAe.js",
			"/assets/session-BAtJOxvx.js"
		]
	},
	"/_authenticated/app/alerts": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.alerts.tsx",
		children: void 0,
		preloads: [
			"/assets/app.alerts-DyjGzGJV.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/format-BXkwTQZM.js"
		]
	},
	"/_authenticated/app/assets": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.assets.tsx",
		children: void 0,
		preloads: [
			"/assets/app.assets-D9Lr76sJ.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/upload-DCi1hUao.js",
			"/assets/createLucideIcon-CEGepnBf.js",
			"/assets/loader-circle-LmZjNfAe.js",
			"/assets/format-BXkwTQZM.js",
			"/assets/Skeleton-Cua8BBmt.js"
		]
	},
	"/_authenticated/app/copilot": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.copilot.tsx",
		children: void 0,
		preloads: [
			"/assets/app.copilot-ByxNEsgd.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/createLucideIcon-CEGepnBf.js",
			"/assets/sparkles-C-wfMPnb.js",
			"/assets/OpsMap-xLUa1Zsr.js"
		]
	},
	"/_authenticated/app/deployment": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.deployment.tsx",
		children: void 0,
		preloads: [
			"/assets/app.deployment-M0sm_4HW.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/createLucideIcon-CEGepnBf.js",
			"/assets/check-CCy2ox4b.js",
			"/assets/sparkles-C-wfMPnb.js"
		]
	},
	"/_authenticated/app/events": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.events.tsx",
		children: void 0,
		preloads: [
			"/assets/app.events-Bzj8KGQ8.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/format-BXkwTQZM.js",
			"/assets/OpsMap-xLUa1Zsr.js",
			"/assets/RiskBadge-DgqzYrjy.js"
		]
	},
	"/_authenticated/app/map": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.map.tsx",
		children: void 0,
		preloads: [
			"/assets/app.map-BaYMzJML.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/search-B10CUpjR.js",
			"/assets/AssetDetailPanel-B_QEoWTM.js",
			"/assets/format-BXkwTQZM.js",
			"/assets/OpsMap-xLUa1Zsr.js",
			"/assets/RiskBadge-DgqzYrjy.js"
		]
	},
	"/_authenticated/app/posture": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.posture.tsx",
		children: void 0,
		preloads: [
			"/assets/app.posture-QyxrH2fo.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/createLucideIcon-CEGepnBf.js",
			"/assets/check-CCy2ox4b.js",
			"/assets/loader-circle-LmZjNfAe.js",
			"/assets/minus-D2hvncCe.js",
			"/assets/rotate-ccw-CasiQsPG.js",
			"/assets/format-BXkwTQZM.js",
			"/assets/RiskBadge-DgqzYrjy.js"
		]
	},
	"/_authenticated/app/risk": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.risk.tsx",
		children: void 0,
		preloads: [
			"/assets/app.risk-5YtaA6Yu.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/createLucideIcon-CEGepnBf.js",
			"/assets/search-B10CUpjR.js",
			"/assets/AssetDetailPanel-B_QEoWTM.js",
			"/assets/format-BXkwTQZM.js",
			"/assets/Skeleton-Cua8BBmt.js",
			"/assets/OpsMap-xLUa1Zsr.js",
			"/assets/RiskBadge-DgqzYrjy.js"
		]
	},
	"/_authenticated/app/thresholds": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.thresholds.tsx",
		children: void 0,
		preloads: [
			"/assets/app.thresholds-DeSzG840.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/createLucideIcon-CEGepnBf.js",
			"/assets/plus-gxGqauJF.js",
			"/assets/rotate-ccw-CasiQsPG.js",
			"/assets/format-BXkwTQZM.js"
		]
	},
	"/_authenticated/app/timeline": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.timeline.tsx",
		children: void 0,
		preloads: [
			"/assets/app.timeline-Cul1ocKU.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/createLucideIcon-CEGepnBf.js",
			"/assets/format-BXkwTQZM.js",
			"/assets/OpsMap-xLUa1Zsr.js",
			"/assets/RiskBadge-DgqzYrjy.js"
		]
	},
	"/_authenticated/app/": {
		filePath: "/Users/taacs/planetary-computer-pro-poc/webapp/src/routes/_authenticated/app.index.tsx",
		children: void 0,
		preloads: [
			"/assets/app.index-Dp27ROWI.js",
			"/assets/use-ops-data-CpRkmyef.js",
			"/assets/upload-DCi1hUao.js",
			"/assets/createLucideIcon-CEGepnBf.js",
			"/assets/loader-circle-LmZjNfAe.js",
			"/assets/sparkles-C-wfMPnb.js",
			"/assets/AssetDetailPanel-B_QEoWTM.js",
			"/assets/format-BXkwTQZM.js",
			"/assets/Skeleton-Cua8BBmt.js",
			"/assets/OpsMap-xLUa1Zsr.js",
			"/assets/RiskBadge-DgqzYrjy.js"
		]
	}
} });
//#endregion
export { tsrStartManifest };
