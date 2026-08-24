import { t as auth } from "./session-Bw-4uMxc.js";
import { useEffect, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Loader2 } from "lucide-react";
//#region src/routes/auth_.callback.tsx?tsr-split=component
function CallbackPage() {
	const [message, setMessage] = useState("Completing sign-in…");
	useEffect(() => {
		let cancelled = false;
		const finish = (session) => {
			if (cancelled) return;
			if (!session) return;
			const stored = sessionStorage.getItem("post-auth-path");
			sessionStorage.removeItem("post-auth-path");
			window.location.replace(stored && stored.startsWith("/") ? stored : "/app");
		};
		const { data: sub } = auth.onAuthStateChange((_e, session) => finish(session));
		auth.getSession().then(({ data }) => {
			if (data.session) finish(data.session);
			else setTimeout(() => {
				if (!cancelled) setMessage("Sign-in did not complete. Return to the sign-in page and try again.");
			}, 6e3);
		});
		return () => {
			cancelled = true;
			sub.subscription.unsubscribe();
		};
	}, []);
	return /* @__PURE__ */ jsx("div", {
		className: "grid min-h-screen place-items-center bg-background text-foreground",
		children: /* @__PURE__ */ jsxs("div", {
			className: "flex items-center gap-3 text-sm text-muted-foreground",
			children: [/* @__PURE__ */ jsx(Loader2, { className: "size-4 animate-spin" }), message]
		})
	});
}
//#endregion
export { CallbackPage as component };
