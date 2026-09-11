import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, lazy, Suspense, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  Boxes,
  ChevronDown,
  Cpu,
  FlaskConical,
  Gauge,
  Layers,
  LayoutGrid,
  LogOut,
  Map as MapIcon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PauseCircle,
  ServerCog,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  UserCog,
  Wind,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { OpsLink, useOpsBase } from "@/components/ops/ops-nav";
import { CopilotDock } from "@/components/ops/CopilotDock";
import { GlobalSearch } from "@/components/ops/GlobalSearch";
import { useAlertFeed } from "@/lib/hooks/use-ops-data";
import { MODES } from "@/report/lib/themes.js";
import { getJson } from "@/report/lib/api.js";

// Equipment-manual resolver (Foundry IQ) — loaded on demand from a notification action.
const ManualResolveModal = lazy(() =>
  import("@/report/components/Manuals.jsx").then((m) => ({
    default: m.ManualResolveModal as React.ComponentType<Record<string, unknown>>,
  })),
);
import { relativeTime } from "@/lib/format";
import { useCapacityStatus } from "@/report/lib/api.js";

// Header bell: a quick slide-down of the current notifications with a link to the
// full Alerts page — instead of navigating away on every click.
function NotificationBell() {
  const base = useOpsBase();
  const { alerts, openCount } = useAlertFeed(base);
  const [open, setOpen] = useState(false);
  const [manualsOn, setManualsOn] = useState(false);
  const [manualWO, setManualWO] = useState<Record<string, unknown> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    getJson("/api/manuals/health")
      .then((h: { enabled?: boolean }) => setManualsOn(!!h?.enabled))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const top = alerts.slice(0, 6);
  const tone = (sev: string) =>
    sev === "critical"
      ? "bg-risk-critical"
      : sev === "warning"
        ? "bg-risk-high"
        : sev === "advisory"
          ? "bg-risk-elevated"
          : "bg-muted-foreground";
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-expanded={open}
        className={cn(
          "relative rounded-sm border p-1.5 transition-colors",
          open
            ? "border-primary/50 bg-primary/20 text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Bell className="size-4" />
        {openCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {openCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-[80] mt-2 w-[22rem] overflow-hidden rounded-md border bg-popover shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold">Notifications</span>
            <span className="text-[10px] text-muted-foreground">{openCount} open</span>
          </div>
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {top.length === 0 && (
              <li className="px-3 py-5 text-center text-xs text-muted-foreground">
                No open notifications.
              </li>
            )}
            {top.map((a) => (
              <li key={a.id} className="flex gap-2 px-3 py-2.5">
                <span className={cn("mt-1 size-2 shrink-0 rounded-full", tone(a.severity))} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{a.title}</div>
                  <div className="line-clamp-2 text-[11px] text-muted-foreground">{a.detail}</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground/80">
                      {relativeTime(a.createdAtIso)}
                    </span>
                    {manualsOn && a.assetId && (
                      <button
                        onClick={() =>
                          setManualWO({
                            wr_id: "",
                            problem_descr: a.detail || a.title,
                            descriptor: a.title,
                            parent_descr: a.title,
                            wr_type: "",
                          })
                        }
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                      >
                        <Wrench className="size-3" /> Action · View manual
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <OpsLink
            to="/alerts"
            onClick={() => setOpen(false)}
            className="block border-t px-3 py-2 text-center text-xs font-medium text-primary hover:bg-accent"
          >
            View all notifications →
          </OpsLink>
        </div>
      )}
      {manualWO &&
        typeof document !== "undefined" &&
        createPortal(
          <Suspense fallback={null}>
            <ManualResolveModal theme={MODES.dark} wo={manualWO} onClose={() => setManualWO(null)} />
          </Suspense>,
          document.body,
        )}
    </div>
  );
}

// Amber strip shown app-wide when the Fabric capacity backing this deployment is paused
// (auto-paused outside operating hours). The backend flags it on /api/status; live data
// resumes automatically when the capacity restarts. Dismissible for the session.
function CapacityBanner({ message }: { message?: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[12.5px] text-amber-200"
    >
      <PauseCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
      <p className="flex-1 leading-snug">
        <span className="font-semibold">Live data paused.</span>{" "}
        {message ||
          "The Fabric capacity backing this deployment is paused. Live readings resume automatically during operating hours."}
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-0.5 text-amber-300/80 transition-colors hover:bg-amber-500/20 hover:text-amber-100"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ---- Unified OneGrid IA. App A areas (Digital Twin, Ontology, Governance) are
// `soon` placeholders until they're ported from the report-app in P1/P3. ----
type Leaf = { to?: string; label: string; icon: LucideIcon; alerts?: number; soon?: boolean };
type Group = { kind: "group"; id: string; label: string; icon: LucideIcon; children: Leaf[] };
type Item = {
  kind: "item";
  to?: string;
  label: string;
  icon: LucideIcon;
  bold?: boolean;
  soon?: boolean;
};
type Entry = Group | Item;

const NAV: Entry[] = [
  { kind: "item", to: "/", label: "Overview", icon: LayoutGrid, bold: true },
  { kind: "item", to: "/asset-explorer", label: "Asset Explorer", icon: Layers },
  {
    kind: "group",
    id: "twin",
    label: "Digital Twin",
    icon: Boxes,
    children: [
      { to: "/control-room", label: "Control Room", icon: Cpu },
      { to: "/simulation", label: "Simulation", icon: FlaskConical },
      { to: "/maintenance", label: "Maintenance", icon: Wrench, alerts: 2 },
    ],
  },
  {
    kind: "group",
    id: "weather",
    label: "Weather",
    icon: Wind,
    children: [
      { to: "/map", label: "Live Map", icon: MapIcon },
      { to: "/events", label: "Forecast Timeline", icon: Timer },
      { to: "/risk", label: "Storm Exposure", icon: Gauge, alerts: 3 },
      { to: "/posture", label: "Response Posture", icon: ShieldAlert },
    ],
  },
  { kind: "item", to: "/ontology", label: "Ontology", icon: Network },
];

const ADMIN: Group = {
  kind: "group",
  id: "admin",
  label: "Admin",
  icon: Settings,
  children: [
    { to: "/thresholds", label: "Thresholds", icon: SlidersHorizontal },
    { to: "/governance", label: "Governance & Security", icon: ShieldCheck },
    { to: "/deployment", label: "Deployment", icon: ServerCog },
  ],
};

const GROUPS = [...NAV.filter((e): e is Group => e.kind === "group"), ADMIN];
const MOBILE_ROUTES = [
  { to: "/", label: "Overview" },
  { to: "/asset-explorer", label: "Asset Explorer" },
  { to: "/control-room", label: "Control Room" },
  { to: "/simulation", label: "Simulation" },
  { to: "/maintenance", label: "Maintenance" },
  { to: "/map", label: "Live Map" },
  { to: "/events", label: "Forecast Timeline" },
  { to: "/risk", label: "Storm Exposure" },
  { to: "/posture", label: "Response Posture" },
  { to: "/ontology", label: "Ontology" },
  { to: "/thresholds", label: "Thresholds" },
  { to: "/governance", label: "Governance & Security" },
  { to: "/deployment", label: "Deployment" },
  { to: "/alerts", label: "Alerts" },
];

function useTheme() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const stored = localStorage.getItem("ops-theme");
    const isDark = stored ? stored === "dark" : true;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);
  const set = (next: boolean) => {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("ops-theme", next ? "dark" : "light");
  };
  return { dark, set };
}

/** OneGrid brand mark: storm cloud + wind + lightning bolt. */
function OneGridMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M6 10 A2.6 2.6 0 0 1 5.8 5 A6 6 0 0 1 15.2 5 A2.6 2.6 0 0 1 16.4 10 Z"
        fill="#c3cedd"
        opacity=".85"
      />
      <g stroke="#fff" strokeWidth="1.7" strokeLinecap="round" opacity=".85">
        <path d="M3 13h6" />
        <path d="M3 16.5h4" />
        <path d="M3 20h7" />
      </g>
      <path d="M16 9.5 L11.5 15.8 L15 15.8 L13.3 22 L20.5 14.5 L16 14.5 Z" fill="#fff" />
    </svg>
  );
}

export function AppShell({
  children,
  fullHeight = false,
}: {
  children: ReactNode;
  /** Command-center pages fill the viewport and scroll inside their own panes. */
  fullHeight?: boolean;
}) {
  const router = useRouter();
  const { dark, set: setDark } = useTheme();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const base = useOpsBase();
  const cap = useCapacityStatus();
  const [profileOpen, setProfileOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // When the chat opens we auto-collapse an expanded nav to reclaim width; this
  // ref remembers to re-expand it on close (only if WE collapsed it).
  const autoCollapsedRef = useRef(false);
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setIsDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // Opening the chat slides the nav closed (preserving screen space) and shifts
  // the main content left of the dock; closing restores the nav if we collapsed it.
  useEffect(() => {
    if (copilotOpen) {
      setCollapsed((c) => {
        if (!c) {
          autoCollapsedRef.current = true;
          return true;
        }
        return c;
      });
    } else if (autoCollapsedRef.current) {
      autoCollapsedRef.current = false;
      setCollapsed(false);
    }
  }, [copilotOpen]);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("og.nav.collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const n = !v;
      try {
        localStorage.setItem("og.nav.collapsed", n ? "1" : "0");
      } catch {
        /* ignore */
      }
      return n;
    });

  const href = (to: string) => (to === "/" ? base : `${base}${to}`);
  const isActive = (to?: string) =>
    !to ? false : to === "/" ? path === base || path === `${base}/` : path.startsWith(href(to));

  const activeGroupId = useMemo(() => {
    for (const g of GROUPS) if (g.children.some((c) => isActive(c.to))) return g.id;
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  const [openId, setOpenId] = useState<string | null>(activeGroupId);
  useEffect(() => {
    if (activeGroupId) setOpenId(activeGroupId);
  }, [activeGroupId]);

  return (
    <div
      className={cn(
        "flex bg-background text-foreground",
        fullHeight ? "min-h-screen xl:h-screen xl:overflow-hidden" : "min-h-screen",
      )}
    >
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar transition-[width] duration-300 ease-in-out lg:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        {/* Brand */}
        <div
          className={cn("flex h-14 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}
        >
          <span
            className="grid size-8 place-items-center rounded-md"
            style={{
              background: "linear-gradient(135deg, var(--color-primary), oklch(0.5 0.145 251))",
            }}
          >
            <OneGridMark className="size-5" />
          </span>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-[13px] font-semibold tracking-tight">
                ONE<span style={{ color: "#38bdf8" }}>GRID</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Asset &amp; weather intelligence
              </div>
            </div>
          )}
        </div>

        {/* Rail */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((e) =>
            e.kind === "item" ? (
              <NavLeaf
                key={e.label}
                leaf={e}
                bold={e.bold ?? false}
                isActive={isActive}
                collapsed={collapsed}
              />
            ) : (
              <NavGroup
                key={e.id}
                group={e}
                open={openId === e.id}
                onToggle={() => setOpenId((v) => (v === e.id ? null : e.id))}
                isActive={isActive}
                collapsed={collapsed}
              />
            ),
          )}

          <div className="my-2 border-t" />

          <NavGroup
            group={ADMIN}
            open={openId === ADMIN.id}
            onToggle={() => setOpenId((v) => (v === ADMIN.id ? null : ADMIN.id))}
            isActive={isActive}
            collapsed={collapsed}
          />
        </nav>

        <div className="border-t p-3 text-[11px] text-muted-foreground">
          {collapsed ? (
            <div className="flex justify-center" title="Tenant deployment · live">
              <span className="size-2 rounded-full bg-emerald-400" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                Tenant deployment
              </div>
              <div className="mt-1">Data reflects the current forecast cycle</div>
            </>
          )}
        </div>
      </aside>

      <div
        className="flex min-w-0 flex-1 flex-col transition-[margin] duration-300 ease-in-out"
        style={{ marginRight: copilotOpen && isDesktop ? 400 : 0 }}
      >
        <header className="sticky top-0 z-[70] flex h-14 items-center gap-3 border-b bg-surface/95 px-4 backdrop-blur">
          {/* Collapse the side menu (desktop) */}
          <button
            onClick={toggleCollapsed}
            className="hidden size-8 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:grid"
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            title={collapsed ? "Expand menu" : "Collapse menu"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
          {/* Mobile nav */}
          <div className="lg:hidden">
            <select
              className="rounded-sm border bg-card px-2 py-1.5 text-xs"
              value={path}
              onChange={(e) => router.navigate({ to: e.target.value })}
            >
              {MOBILE_ROUTES.map((n) => (
                <option key={n.to} value={href(n.to)}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <GlobalSearch />

            {/* Alerts: quick dropdown of current notifications + link to the full page */}
            <NotificationBell />

            {/* Profile */}
            <div className="relative">
              <button
                onClick={() => setProfileOpen((o) => !o)}
                className="grid size-8 place-items-center rounded-full text-[12px] font-bold text-white"
                style={{
                  background: "linear-gradient(135deg, var(--color-primary), oklch(0.62 0.13 249))",
                }}
                aria-label="Your profile"
              >
                PS
              </button>
              {profileOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                  <div className="absolute right-0 top-11 z-50 w-64 rounded-lg border bg-card p-1.5 shadow-2xl">
                    <div className="flex items-center gap-2.5 p-2">
                      <span
                        className="grid size-9 place-items-center rounded-full text-[12px] font-bold text-white"
                        style={{
                          background:
                            "linear-gradient(135deg, var(--color-primary), oklch(0.62 0.13 249))",
                        }}
                      >
                        PS
                      </span>
                      <div className="leading-tight">
                        <div className="text-[13px] font-semibold">Paul Shaheen</div>
                        <div className="text-[11px] text-muted-foreground">
                          paul.shaheen@contoso.com
                        </div>
                      </div>
                    </div>
                    <div className="my-1 border-t" />
                    <div className="px-2 pb-1 pt-1.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                      My preferences
                    </div>
                    <div className="flex items-center justify-between px-2 py-1.5 text-[13px]">
                      <span>Theme</span>
                      <span className="inline-flex overflow-hidden rounded-md border">
                        <button
                          onClick={() => setDark(true)}
                          className={cn(
                            "px-2.5 py-1 text-[11px] font-semibold",
                            dark ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                          )}
                        >
                          Dark
                        </button>
                        <button
                          onClick={() => setDark(false)}
                          className={cn(
                            "px-2.5 py-1 text-[11px] font-semibold",
                            !dark ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                          )}
                        >
                          Light
                        </button>
                      </span>
                    </div>
                    <div className="my-1 border-t" />
                    <button className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] hover:bg-accent">
                      <UserCog className="size-4" /> Profile &amp; account
                    </button>
                    <button className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] hover:bg-accent">
                      <LogOut className="size-4" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {cap.capacityPaused && <CapacityBanner message={cap.message} />}

        <main className={cn("min-w-0 flex-1", fullHeight && "xl:min-h-0 xl:overflow-hidden")}>
          {children}
        </main>
      </div>
      <CopilotDock open={copilotOpen} setOpen={setCopilotOpen} />
    </div>
  );
}

function NavLeaf({
  leaf,
  bold,
  nested,
  isActive,
  collapsed,
}: {
  leaf: Leaf;
  bold?: boolean;
  nested?: boolean;
  isActive: (to?: string) => boolean;
  collapsed?: boolean;
}) {
  const rowCls = "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] transition-colors";
  const pad = nested ? "pl-3.5" : "";

  if (collapsed) {
    if (leaf.soon) {
      return (
        <div
          className="flex items-center justify-center rounded-sm py-2 text-muted-foreground/55"
          title={`${leaf.label} — coming soon`}
        >
          <leaf.icon className="size-5" />
        </div>
      );
    }
    const active = isActive(leaf.to);
    return (
      <OpsLink
        to={leaf.to as string}
        title={leaf.label}
        className={cn(
          "relative flex items-center justify-center rounded-sm py-2 transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-inset ring-primary/30"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        <leaf.icon className="size-5" />
        {leaf.alerts ? (
          <span className="absolute top-1 right-1.5 size-1.5 rounded-full bg-destructive" />
        ) : null}
      </OpsLink>
    );
  }

  if (leaf.soon) {
    return (
      <div
        className={cn(rowCls, pad, "cursor-default text-muted-foreground/55")}
        title="Coming soon — ported from OneGrid report-app"
      >
        <leaf.icon className="size-4 shrink-0" />
        <span className="flex-1 truncate">{leaf.label}</span>
        <span className="rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
          Soon
        </span>
      </div>
    );
  }

  const active = isActive(leaf.to);
  return (
    <OpsLink
      to={leaf.to as string}
      className={cn(
        rowCls,
        pad,
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground ring-1 ring-inset ring-primary/30"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <leaf.icon className="size-4 shrink-0" />
      <span className={cn("flex-1 truncate", bold && "font-semibold")}>{leaf.label}</span>
      {leaf.alerts ? (
        <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive/25 px-1 text-[10px] font-bold text-destructive">
          {leaf.alerts}
        </span>
      ) : null}
    </OpsLink>
  );
}

function NavGroup({
  group,
  open,
  onToggle,
  isActive,
  collapsed,
}: {
  group: Group;
  open: boolean;
  onToggle: () => void;
  isActive: (to?: string) => boolean;
  collapsed?: boolean;
}) {
  const roll = group.children.reduce((s, c) => s + (c.alerts ?? 0), 0);
  if (collapsed) {
    const firstTo = group.children[0]?.to;
    const anyActive = group.children.some((c) => isActive(c.to));
    return (
      <OpsLink
        to={(firstTo ?? "/") as string}
        title={group.label}
        className={cn(
          "relative flex items-center justify-center rounded-sm py-2 transition-colors",
          anyActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-inset ring-primary/30"
            : "text-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <group.icon className="size-5" />
        {roll ? (
          <span className="absolute top-1 right-1.5 size-1.5 rounded-full bg-destructive" />
        ) : null}
      </OpsLink>
    );
  }
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-sidebar-accent/60"
      >
        <group.icon className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">{group.label}</span>
        {roll ? (
          <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive/25 px-1 text-[10px] font-bold text-destructive">
            {roll}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="mt-0.5 ml-3 space-y-0.5 border-l pl-1">
          {group.children.map((c) => (
            <NavLeaf key={c.label} leaf={c} nested isActive={isActive} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-surface px-5 py-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{description}</p>
      </div>
      {actions}
    </div>
  );
}
