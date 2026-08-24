import { n as Route } from "./router-DsFxjoFW.js";
import { t as auth } from "./session-Bw-4uMxc.js";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { Loader2, ShieldCheck, Wind } from "lucide-react";
//#region src/routes/auth.tsx?tsr-split=component
function safePath(value) {
	if (!value) return "/app";
	try {
		const url = new URL(value, window.location.origin);
		if (url.origin !== window.location.origin) return "/app";
		return url.pathname + url.search;
	} catch {
		return "/app";
	}
}
function AuthPage() {
	const search = Route.useSearch();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	useEffect(() => {
		auth.getSession().then(({ data }) => {
			if (data.session) window.location.replace(safePath(search.redirect));
		});
	}, [search.redirect]);
	async function signInWithEntra() {
		setError(null);
		setBusy(true);
		sessionStorage.setItem("post-auth-path", safePath(search.redirect));
		const { error: err } = await auth.signInWithEntra();
		if (err) {
			setBusy(false);
			setError(err.message);
		}
	}
	return /* @__PURE__ */ jsxs("div", {
		className: "relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground",
		children: [
			/* @__PURE__ */ jsx("div", {
				"aria-hidden": true,
				className: "pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_60rem_at_50%_-10%,color-mix(in_oklab,var(--color-primary)_10%,transparent),transparent)]"
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "flex w-full max-w-[360px] flex-col items-center",
				children: [
					/* @__PURE__ */ jsxs(Link, {
						to: "/",
						className: "flex flex-col items-center gap-3",
						"aria-label": "Asset Weather Ops home",
						children: [/* @__PURE__ */ jsx("span", {
							className: "grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm",
							children: /* @__PURE__ */ jsx(Wind, { className: "size-5" })
						}), /* @__PURE__ */ jsx("span", {
							className: "text-[13px] font-medium tracking-wide text-muted-foreground",
							children: "Asset Weather Ops"
						})]
					}),
					/* @__PURE__ */ jsx("h1", {
						className: "mt-8 text-center text-[1.75rem] font-semibold leading-tight tracking-tight",
						children: "Sign in"
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-2 text-center text-sm text-muted-foreground",
						children: "Continue with your work or school account."
					}),
					/* @__PURE__ */ jsxs("button", {
						onClick: () => void signInWithEntra(),
						disabled: busy,
						className: "mt-8 flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border bg-card px-4 text-sm font-medium shadow-sm transition-all hover:bg-accent hover:shadow disabled:cursor-not-allowed disabled:opacity-60",
						children: [busy ? /* @__PURE__ */ jsx(Loader2, { className: "size-4 animate-spin" }) : /* @__PURE__ */ jsxs("svg", {
							viewBox: "0 0 23 23",
							className: "size-[18px]",
							"aria-hidden": true,
							children: [
								/* @__PURE__ */ jsx("rect", {
									x: "1",
									y: "1",
									width: "10",
									height: "10",
									fill: "#f25022"
								}),
								/* @__PURE__ */ jsx("rect", {
									x: "12",
									y: "1",
									width: "10",
									height: "10",
									fill: "#7fba00"
								}),
								/* @__PURE__ */ jsx("rect", {
									x: "1",
									y: "12",
									width: "10",
									height: "10",
									fill: "#00a4ef"
								}),
								/* @__PURE__ */ jsx("rect", {
									x: "12",
									y: "12",
									width: "10",
									height: "10",
									fill: "#ffb900"
								})
							]
						}), "Sign in with Microsoft"]
					}),
					error ? /* @__PURE__ */ jsx("p", {
						className: "mt-4 w-full text-center text-sm text-risk-critical",
						children: error
					}) : null,
					/* @__PURE__ */ jsxs("div", {
						className: "mt-8 flex items-center gap-2 text-[11px] text-muted-foreground",
						children: [/* @__PURE__ */ jsx(ShieldCheck, { className: "size-3.5" }), /* @__PURE__ */ jsx("span", { children: "Protected by Microsoft Entra ID" })]
					})
				]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "absolute bottom-6 text-center text-[11px] text-muted-foreground/70",
				children: "MFA and conditional access are enforced by your directory."
			})
		]
	});
}
//#endregion
export { AuthPage as component };
