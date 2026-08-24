import { a as coords, i as STATUS_LABEL, t as ASSET_TYPE_LABEL } from "./format-CGsoAMDh.js";
import { S as PageHeader, d as getDataPlaneStatus, p as uploadAsset, r as assetsQuery, w as useOpsBase, x as AppShell } from "./use-ops-data-B8Zw8Vry.js";
import { t as SkeletonRows } from "./Skeleton-LqERzdGS.js";
import { useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { CheckCircle2, Database, FileSpreadsheet, Globe, Layers, Loader2, Plug, Server, Upload } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
//#region src/views/assets.tsx
function readAsBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result;
			resolve(result.slice(result.indexOf(",") + 1));
		};
		reader.onerror = () => reject(/* @__PURE__ */ new Error("Could not read the file."));
		reader.readAsDataURL(file);
	});
}
var CONNECTORS = [
	{
		id: "csv",
		name: "CSV upload",
		detail: "Point-asset registers with latitude and longitude columns",
		icon: FileSpreadsheet,
		status: "Available"
	},
	{
		id: "geojson",
		name: "GeoJSON",
		detail: "Point, line and polygon geometry for corridors and lease blocks",
		icon: Globe,
		status: "Available"
	},
	{
		id: "shapefile",
		name: "Shapefile",
		detail: "Zipped ESRI shapefiles from survey and GIS teams",
		icon: Layers,
		status: "Available"
	},
	{
		id: "arcgis",
		name: "ArcGIS feature service",
		detail: "Live feature layers from the corporate GIS",
		icon: Globe,
		status: "Configure"
	},
	{
		id: "blob",
		name: "Cloud storage container",
		detail: "Scheduled ingest from your governed data landing zone",
		icon: Database,
		status: "Configure"
	},
	{
		id: "fabric",
		name: "Enterprise data platform",
		detail: "Governed asset master from your analytics platform",
		icon: Server,
		status: "Configure"
	},
	{
		id: "rest",
		name: "REST API",
		detail: "Pull from maintenance, SCADA or asset-management systems",
		icon: Plug,
		status: "Configure"
	}
];
var SCHEMA = [
	[
		"id",
		"string",
		"Unique asset identifier",
		"Required"
	],
	[
		"name",
		"string",
		"Operator-facing asset name",
		"Required"
	],
	[
		"type",
		"enum",
		"platform, pipeline, well, refinery, lng_terminal, storage, port",
		"Required"
	],
	[
		"latitude",
		"number",
		"Decimal degrees",
		"Required for point assets"
	],
	[
		"longitude",
		"number",
		"Decimal degrees",
		"Required for point assets"
	],
	[
		"geometry",
		"geojson",
		"Line or polygon geometry for corridors and areas",
		"Optional"
	],
	[
		"operator",
		"string",
		"Operating company",
		"Optional"
	],
	[
		"region",
		"string",
		"Operating region",
		"Optional"
	],
	[
		"business_unit",
		"string",
		"Reporting business unit",
		"Optional"
	],
	[
		"operating_status",
		"enum",
		"producing, reduced, shut_in, evacuating, standby",
		"Optional"
	],
	[
		"criticality",
		"enum",
		"standard, important, business_critical",
		"Drives risk weighting"
	],
	[
		"metadata",
		"object",
		"Design wind speed, capacity, personnel on board, etc.",
		"Optional"
	]
];
function AssetsPage() {
	const base = useOpsBase();
	const assetsQ = useQuery(assetsQuery(base));
	const assets = assetsQ.data ?? [];
	const [q, setQ] = useState("");
	const fileInputRef = useRef(null);
	const [note, setNote] = useState(null);
	const uploadReady = useQuery({
		queryKey: [base, "data-plane-status"],
		queryFn: () => getDataPlaneStatus(),
		staleTime: 3e5
	}).data?.uploadConfigured ?? false;
	const upload = useMutation({
		mutationFn: async (file) => {
			const contentBase64 = await readAsBase64(file);
			return uploadAsset({ data: {
				name: file.name,
				contentBase64,
				contentType: file.type
			} });
		},
		onSuccess: (res) => setNote({
			ok: res.ok,
			text: res.message
		}),
		onError: () => setNote({
			ok: false,
			text: "Upload failed unexpectedly."
		})
	});
	const rows = useMemo(() => assets.filter((a) => `${a.name} ${a.id} ${a.operator} ${a.region}`.toLowerCase().includes(q.toLowerCase())).slice(0, 100), [assets, q]);
	return /* @__PURE__ */ jsxs(AppShell, { children: [
		/* @__PURE__ */ jsx(PageHeader, {
			title: "Asset Management",
			description: "Connect your infrastructure estate. Upload files directly to this deployment's storage, or wire a live source — nothing is pre-populated."
		}),
		/* @__PURE__ */ jsx("input", {
			ref: fileInputRef,
			type: "file",
			className: "hidden",
			onChange: (e) => {
				const file = e.target.files?.[0];
				if (file) upload.mutate(file);
				e.target.value = "";
			}
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "space-y-4 p-4",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "panel",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "flex items-center justify-between border-b px-4 py-2.5",
					children: [/* @__PURE__ */ jsx("span", {
						className: "label-xs",
						children: "Data sources"
					}), note && /* @__PURE__ */ jsxs("span", {
						className: `inline-flex items-center gap-1.5 text-[11px] ${note.ok ? "text-risk-normal" : "text-risk-high"}`,
						children: [note.ok && /* @__PURE__ */ jsx(CheckCircle2, { className: "size-3.5" }), note.text]
					})]
				}), /* @__PURE__ */ jsx("div", {
					className: "grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4",
					children: CONNECTORS.map((c) => {
						const isUpload = c.status === "Available";
						return /* @__PURE__ */ jsxs("div", {
							className: "bg-card p-4",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ jsx(c.icon, { className: "size-4 text-primary" }), /* @__PURE__ */ jsx("span", {
										className: "text-xs font-medium",
										children: c.name
									})]
								}),
								/* @__PURE__ */ jsx("p", {
									className: "mt-1.5 text-[11px] text-muted-foreground",
									children: c.detail
								}),
								isUpload ? /* @__PURE__ */ jsxs("button", {
									disabled: !uploadReady || upload.isPending,
									onClick: () => fileInputRef.current?.click(),
									className: "mt-3 inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50",
									children: [upload.isPending ? /* @__PURE__ */ jsx(Loader2, { className: "size-3 animate-spin" }) : /* @__PURE__ */ jsx(Upload, { className: "size-3" }), uploadReady ? "Upload file" : "Storage not wired"]
								}) : /* @__PURE__ */ jsx("span", {
									className: "mt-3 inline-block rounded-sm border px-2 py-1 text-[11px] text-muted-foreground",
									children: "Configure at deploy time"
								})
							]
						}, c.id);
					})
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "panel",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-2 border-b px-4 py-2.5",
							children: [/* @__PURE__ */ jsx("span", {
								className: "label-xs",
								children: "Current asset register"
							}), /* @__PURE__ */ jsx("input", {
								value: q,
								onChange: (e) => setQ(e.target.value),
								placeholder: "Search",
								className: "ml-auto w-56 rounded-sm border bg-card px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
							})]
						}),
						/* @__PURE__ */ jsx("div", {
							className: "max-h-[520px] overflow-y-auto",
							children: /* @__PURE__ */ jsxs("table", {
								className: "w-full text-xs",
								children: [/* @__PURE__ */ jsx("thead", {
									className: "sticky top-0 bg-card text-left text-[11px] text-muted-foreground",
									children: /* @__PURE__ */ jsxs("tr", { children: [
										/* @__PURE__ */ jsx("th", {
											className: "px-4 py-2 font-medium",
											children: "ID"
										}),
										/* @__PURE__ */ jsx("th", {
											className: "px-4 py-2 font-medium",
											children: "Name"
										}),
										/* @__PURE__ */ jsx("th", {
											className: "px-4 py-2 font-medium",
											children: "Type"
										}),
										/* @__PURE__ */ jsx("th", {
											className: "px-4 py-2 font-medium",
											children: "Location"
										}),
										/* @__PURE__ */ jsx("th", {
											className: "px-4 py-2 font-medium",
											children: "Status"
										})
									] })
								}), /* @__PURE__ */ jsxs("tbody", { children: [
									assetsQ.isLoading && rows.length === 0 && /* @__PURE__ */ jsx(SkeletonRows, {
										rows: 8,
										cols: 5
									}),
									rows.map((a) => /* @__PURE__ */ jsxs("tr", {
										className: "border-t",
										children: [
											/* @__PURE__ */ jsx("td", {
												className: "num px-4 py-2 text-muted-foreground",
												children: a.id
											}),
											/* @__PURE__ */ jsx("td", {
												className: "px-4 py-2 font-medium",
												children: a.name
											}),
											/* @__PURE__ */ jsx("td", {
												className: "px-4 py-2 text-muted-foreground",
												children: ASSET_TYPE_LABEL[a.type]
											}),
											/* @__PURE__ */ jsx("td", {
												className: "num px-4 py-2 text-muted-foreground",
												children: coords(a.lat, a.lon)
											}),
											/* @__PURE__ */ jsx("td", {
												className: "px-4 py-2",
												children: STATUS_LABEL[a.status]
											})
										]
									}, a.id)),
									!assetsQ.isLoading && rows.length === 0 && /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx("td", {
										colSpan: 5,
										className: "px-4 py-10 text-center text-muted-foreground",
										children: assets.length === 0 ? "No assets yet — upload a file or wire a source above to populate the register." : "No assets match your search."
									}) })
								] })]
							})
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "border-t px-4 py-2 text-[11px] text-muted-foreground",
							children: [
								"Showing ",
								rows.length,
								" of ",
								assets.length,
								" assets in the tenant register."
							]
						})
					]
				}), /* @__PURE__ */ jsxs("div", {
					className: "space-y-4",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "panel",
						children: [/* @__PURE__ */ jsx("div", {
							className: "border-b px-4 py-2.5 label-xs",
							children: "Asset schema"
						}), /* @__PURE__ */ jsx("table", {
							className: "w-full text-[11px]",
							children: /* @__PURE__ */ jsx("tbody", { children: SCHEMA.map(([field, type, desc, req]) => /* @__PURE__ */ jsxs("tr", {
								className: "border-t align-top",
								children: [
									/* @__PURE__ */ jsx("td", {
										className: "num px-4 py-2 font-medium",
										children: field
									}),
									/* @__PURE__ */ jsx("td", {
										className: "px-2 py-2 text-muted-foreground",
										children: type
									}),
									/* @__PURE__ */ jsx("td", {
										className: "px-2 py-2 text-muted-foreground",
										children: desc
									}),
									/* @__PURE__ */ jsx("td", {
										className: "px-4 py-2 text-right text-muted-foreground",
										children: req
									})
								]
							}, field)) })
						})]
					}), /* @__PURE__ */ jsxs("div", {
						className: "panel p-4",
						children: [/* @__PURE__ */ jsx("div", {
							className: "label-xs mb-2",
							children: "How ingestion works"
						}), /* @__PURE__ */ jsx("ul", {
							className: "space-y-1.5 text-[11px] text-muted-foreground",
							children: [
								"Uploaded files land in the deployment's blob container via managed identity — no keys",
								"Risk scoring, alerts and the assistant read the same interfaces as live sources",
								"Live connectors (ArcGIS, storage, data platform, REST) are wired at deploy time"
							].map((t) => /* @__PURE__ */ jsxs("li", {
								className: "flex gap-2",
								children: [/* @__PURE__ */ jsx(CheckCircle2, { className: "mt-0.5 size-3 shrink-0 text-primary" }), t]
							}, t))
						})]
					})]
				})]
			})]
		})
	] });
}
//#endregion
//#region src/routes/_authenticated/app.assets.tsx?tsr-split=component
var SplitComponent = AssetsPage;
//#endregion
export { SplitComponent as component };
