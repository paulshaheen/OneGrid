import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bell,
  Boxes,
  ChevronDown,
  CloudLightning,
  Cpu,
  FlaskConical,
  Gauge,
  Layers,
  LayoutGrid,
  LogOut,
  Map as MapIcon,
  Network,
  ServerCog,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCog,
  Wind,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { OpsLink, useOpsBase } from "@/components/ops/ops-nav";
import { CopilotDock } from "@/components/ops/CopilotDock";

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
  { kind: "item", to: "/assets", label: "Asset Explorer", icon: Layers },
  {
    kind: "group",
    id: "twin",
    label: "Digital Twin",
    icon: Boxes,
    children: [
      { label: "Control Room", icon: Cpu, soon: true },
      { label: "Simulation", icon: FlaskConical, soon: true },
      { label: "Maintenance", icon: Wrench, alerts: 2, soon: true },
    ],
  },
  {
    kind: "group",
    id: "weather",
    label: "Weather",
    icon: Wind,
    children: [
      { to: "/map", label: "Live Map", icon: MapIcon },
      { to: "/events", label: "Forecast", icon: CloudLightning },
      { to: "/risk", label: "Storm Exposure", icon: Gauge, alerts: 3 },
      { to: "/posture", label: "Response Posture", icon: ShieldAlert },
    ],
  },
  { kind: "item", to: "/ontology", label: "Ontology", icon: Network, soon: true },
];

const ADMIN: Group = {
  kind: "group",
  id: "admin",
  label: "Admin",
  icon: Settings,
  children: [
    { to: "/thresholds", label: "Thresholds", icon: SlidersHorizontal },
    { label: "Governance & Security", icon: ShieldCheck, soon: true },
    { to: "/deployment", label: "Deployment", icon: ServerCog },
  ],
};

const GROUPS = [...NAV.filter((e): e is Group => e.kind === "group"), ADMIN];
const MOBILE_ROUTES = [
  { to: "/", label: "Overview" },
  { to: "/assets", label: "Asset Explorer" },
  { to: "/map", label: "Live Map" },
  { to: "/events", label: "Forecast" },
  { to: "/risk", label: "Storm Exposure" },
  { to: "/posture", label: "Response Posture" },
  { to: "/thresholds", label: "Thresholds" },
  { to: "/deployment", label: "Deployment" },
  { to: "/alerts", label: "Alerts" },
  { to: "/copilot", label: "Copilot" },
];
const TOTAL_ALERTS = 5;

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

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

  const onAlerts = isActive("/alerts");

  return (
    <div
      className={cn(
        "flex bg-background text-foreground",
        fullHeight ? "min-h-screen xl:h-screen xl:overflow-hidden" : "min-h-screen",
      )}
    >
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        {/* Brand */}
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <span
            className="grid size-8 place-items-center rounded-md"
            style={{
              background: "linear-gradient(135deg, var(--color-primary), oklch(0.5 0.145 251))",
            }}
          >
            <OneGridMark className="size-5" />
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">OneGrid</div>
            <div className="text-[10px] text-muted-foreground">
              Asset &amp; weather intelligence
            </div>
          </div>
        </div>

        {/* Rail */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((e) =>
            e.kind === "item" ? (
              <NavLeaf key={e.label} leaf={e} bold={e.bold ?? false} isActive={isActive} />
            ) : (
              <NavGroup
                key={e.id}
                group={e}
                open={openId === e.id}
                onToggle={() => setOpenId((v) => (v === e.id ? null : e.id))}
                isActive={isActive}
              />
            ),
          )}

          <div className="my-2 border-t" />

          <NavGroup
            group={ADMIN}
            open={openId === ADMIN.id}
            onToggle={() => setOpenId((v) => (v === ADMIN.id ? null : ADMIN.id))}
            isActive={isActive}
          />
        </nav>

        <div className="border-t p-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Tenant deployment
          </div>
          <div className="mt-1">Data reflects the current forecast cycle</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-surface/95 px-4 backdrop-blur">
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
            <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground md:inline-flex">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Fabric live · GoM tenant
            </span>

            <button
              onClick={() => setCopilotOpen(true)}
              className="hidden items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground sm:inline-flex"
            >
              <Sparkles className="size-3.5" />
              Ask the data
            </button>

            {/* Alerts: open the inbox; if already there, go back to the previous page */}
            <OpsLink
              to="/alerts"
              onClick={(e) => {
                if (onAlerts) {
                  e.preventDefault();
                  router.history.back();
                }
              }}
              className={cn(
                "relative rounded-sm border p-1.5 transition-colors",
                onAlerts
                  ? "border-primary/50 bg-primary/20 text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              aria-label="Alerts"
            >
              <Bell className="size-4" />
              {TOTAL_ALERTS > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                  {TOTAL_ALERTS}
                </span>
              )}
            </OpsLink>

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
}: {
  leaf: Leaf;
  bold?: boolean;
  nested?: boolean;
  isActive: (to?: string) => boolean;
}) {
  const rowCls = "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] transition-colors";
  const pad = nested ? "pl-3.5" : "";

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
}: {
  group: Group;
  open: boolean;
  onToggle: () => void;
  isActive: (to?: string) => boolean;
}) {
  const roll = group.children.reduce((s, c) => s + (c.alerts ?? 0), 0);
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
