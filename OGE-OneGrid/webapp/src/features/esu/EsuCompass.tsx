import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  Download,
  FileText,
  HardDrive,
  Layers3,
  LayoutDashboard,
  LifeBuoy,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wallet,
  Trash2,
  Pencil,
  ExternalLink,
  AlertTriangle,
  FolderOpen,
  Calculator,
  Compass,
  Menu,
  X,
} from "lucide-react";
import {
  initialState,
  estimate,
  migration,
  miCost,
  money,
  programFor,
  statusFor,
  addMonths,
  addDays,
  hours,
  stamp,
  newHost,
  newWorkload,
  uid,
  sources,
  programs,
  download,
  csvTemplate,
  csvEscape,
  validateState,
  importInventory,
  parseRates,
  type Estimate,
  type State,
  type Host,
  type Workload,
  type MI,
  type PriceBook,
  type RetailItem,
} from "./esu-core";
import { Field, NumberInput, Toggle, Notice, Badge, Empty } from "./ui";
import { HostEditor, WorkloadEditor } from "./editors";
import "./esu.css";
const navs = [
  ["overview", "Overview", LayoutDashboard],
  ["inventory", "Your footprint", Layers3],
  ["costs", "ESU cost analysis", Calculator],
  ["migration", "Modernization", Cloud],
  ["rates", "Rates & agreements", SlidersHorizontal],
  ["sources", "Rules & sources", FileText],
] as const;
const regionNames: Record<string, string> = {
  eastus: "East US",
  eastus2: "East US 2",
  westus2: "West US 2",
  westus3: "West US 3",
  centralus: "Central US",
  southcentralus: "South Central US",
  northeurope: "North Europe",
  westeurope: "West Europe",
  uksouth: "UK South",
  australiaeast: "Australia East",
  southeastasia: "Southeast Asia",
  canadacentral: "Canada Central",
};
const key = "esu-compass-state-v1";
const nf = (n: number) => new Intl.NumberFormat("en-US").format(n);
const dayLabel = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
function Brand() {
  return (
    <span className="brand-symbol" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
function Chart({ data }: { data: Estimate["months"] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div className="chart" aria-label="Monthly forecast bar chart">
      <div className="chart-axis">
        <span>{money(max)}</span>
        <span>{money(max / 2)}</span>
        <span>$0</span>
      </div>
      <div className="chart-plot">
        {data.map((d, i) => (
          <div className="chart-column" key={i}>
            <div className="chart-bar-wrap" title={`${d.label}: ${money(d.total, 2)}`}>
              <div
                className="chart-bar"
                style={{ height: Math.max(2, (d.total / max) * 150) + "px" }}
              >
                <div className="seg amber" style={{ flex: d.catchup }} />
                <div className="seg purple" style={{ flex: d.annual }} />
                <div className="seg blue" style={{ flex: d.esu }} />
                <div className="seg teal" style={{ flex: d.base }} />
              </div>
            </div>
            <span>{data.length > 18 && i % 3 !== 0 ? "" : d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function Metric({
  label,
  value,
  caption,
  icon,
  tone = "",
}: {
  label: string;
  value: ReactNode;
  caption: ReactNode;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <div className={"metric " + tone}>
      <div className="metric-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{caption}</p>
    </div>
  );
}
function Breakdown({
  label,
  value,
  bold = false,
}: {
  label: ReactNode;
  value: ReactNode;
  bold?: boolean;
}) {
  return (
    <div className={"breakdown-row " + (bold ? "total" : "")}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function LifecycleBadge({
  family,
  version,
  date,
}: {
  family: "windows" | "sql";
  version: string;
  date: string;
}) {
  const status = statusFor(programFor(family, version), date);
  return (
    <Badge tone={status === "esu" ? "amber" : status === "supported" ? "green" : "red"}>
      {status === "esu"
        ? "ESU active"
        : status === "supported"
          ? "Supported"
          : status === "expired"
            ? "ESU ended"
            : "Needs review"}
    </Badge>
  );
}
export function EsuCompass() {
  const [s, setS] = useState<State>(() => initialState()),
    [loaded, setLoaded] = useState(false),
    [tab, setTab] = useState("overview"),
    [toast, setToast] = useState(""),
    [hostEdit, setHostEdit] = useState<Host | null>(null),
    [workEdit, setWorkEdit] = useState<Workload | null>(null),
    [search, setSearch] = useState(""),
    [channel, setChannel] = useState<"arc" | "annual">("arc"),
    [refreshing, setRefreshing] = useState(false),
    [rateRegion, setRateRegion] = useState("eastus"),
    [mobileNav, setMobileNav] = useState(false),
    [expanded, setExpanded] = useState<Record<string, boolean>>({}),
    [rulesTab, setRulesTab] = useState("guidance");
  const jsonInput = useRef<HTMLInputElement>(null),
    csvInput = useRef<HTMLInputElement>(null);
  const notify = (v: string) => {
    setToast(v);
    setTimeout(() => setToast(""), 6000);
  };
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const v = validateState(JSON.parse(saved));
        setS(v);
        setRateRegion(v.prices.region);
      }
    } catch {
      setToast("Saved scenario could not be restored. You can import a backup.");
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(key, JSON.stringify(s));
      } catch {
        setToast("Browser storage is full. Export this scenario to keep your changes.");
      }
    }
  }, [s, loaded]);
  const update = (patch: Partial<State>) => setS((v) => ({ ...v, ...patch }));
  const updateMI = (patch: Partial<MI>) => setS((v) => ({ ...v, mi: { ...v.mi, ...patch } }));
  const arc = useMemo(() => estimate(s, "arc"), [s]),
    annual = useMemo(() => estimate(s, "annual"), [s]),
    mig = useMemo(() => migration(s), [s]),
    mc = useMemo(() => miCost(s), [s]);
  const e = channel === "arc" ? arc : annual;
  const vmCount = s.workloads.reduce(
      (n, w) => n + w.quantity * (s.hosts.find((h) => h.id === w.hostId)?.quantity || 0),
      0,
    ),
    hostCount = s.hosts.reduce((n, h) => n + h.quantity, 0),
    sqlCount = s.workloads
      .filter((w) => w.sql.length > 0)
      .reduce(
        (n, w) => n + w.quantity * (s.hosts.find((h) => h.id === w.hostId)?.quantity || 0),
        0,
      );
  const modeledMonths = hours(s.start, arc.end) / 730,
    extras = (s.costs.saMonthly + s.costs.otherMonthly) * modeledMonths + s.costs.oneTime;
  const allIssues = [...arc.missing, ...arc.coverageGaps, ...arc.warnings];
  const go = (t: string) => {
    setTab(t);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  async function importFile(file: File | undefined, csv: boolean) {
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error("File is too large. Maximum 10 MB.");
      const text = await file.text();
      const data = csv ? importInventory(text, s) : validateState(JSON.parse(text));
      if (
        !window.confirm(
          csv
            ? "Replace the current footprint with this CSV? Rates and scenario settings will stay."
            : "Replace the current scenario with this file?",
        )
      )
        return;
      setS(data);
      setRateRegion(data.prices.region);
      notify(
        csv ? "Footprint imported. Review coverage dates and entitlements." : "Scenario restored.",
      );
      go("inventory");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Unable to import file.");
    } finally {
      if (jsonInput.current) jsonInput.current.value = "";
      if (csvInput.current) csvInput.current.value = "";
    }
  }
  async function refreshRates() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/prices?region=" + encodeURIComponent(rateRegion));
      const data = (await r.json()) as {
        items?: RetailItem[];
        region?: string;
        checked?: string;
        error?: string;
      };
      if (!r.ok || !data.items) throw new Error(data.error || "Unable to refresh pricing.");
      const book = parseRates(
        data.items,
        data.region || rateRegion,
        data.checked || new Date().toISOString().slice(0, 10),
      );
      if (!book.meters["sql-2016-Standard"] || !book.meters["mi-gp-compute"])
        throw new Error("No complete public-cloud price set was returned for this region.");
      update({ prices: { ...book, annual: s.prices.annual, notes: s.prices.notes } });
      notify(
        "Microsoft retail rates refreshed. Custom hourly overrides were replaced; annual quotes retained.",
      );
    } catch (err) {
      notify(
        (err instanceof Error ? err.message : "Refresh failed.") + " Existing rates are unchanged.",
      );
    } finally {
      setRefreshing(false);
    }
  }
  function exportCSV() {
    const rows = [
      [
        "Workload",
        "Product",
        "Version",
        "Edition",
        "Cores",
        "Status",
        "Charge type",
        "Start UTC",
        "End exclusive UTC",
        "Amount USD",
        "Calculation",
      ],
      ...e.charges.map((c) => {
        const l = e.lines.find((l) => l.id === c.lineId)!;
        return [
          l.label,
          l.family,
          l.version,
          l.edition,
          l.units,
          l.status,
          c.kind,
          c.date,
          c.end,
          c.amount.toFixed(2),
          c.detail,
        ];
      }),
    ];
    download(
      "ESU-Cost-Breakdown.csv",
      rows.map((r) => r.map(csvEscape).join(",")).join("\n"),
      "text/csv",
    );
  }
  function saveHost(h: Host) {
    try {
      const next = validateState({
        ...s,
        sample: false,
        hosts: s.hosts.some((x) => x.id === h.id)
          ? s.hosts.map((x) => (x.id === h.id ? h : x))
          : [...s.hosts, h],
      });
      setS(next);
      setHostEdit(null);
      notify("Host configuration saved.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Check host inputs.");
    }
  }
  function saveWork(w: Workload) {
    try {
      const next = validateState({
        ...s,
        sample: false,
        workloads: s.workloads.some((x) => x.id === w.id)
          ? s.workloads.map((x) => (x.id === w.id ? w : x))
          : [...s.workloads, w],
      });
      setS(next);
      setWorkEdit(null);
      notify("Workload saved. Costs recalculated.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Check workload inputs.");
    }
  }
  function removeHost(id: string) {
    if (window.confirm("Remove this host group and all of its workloads?"))
      update({
        sample: false,
        hosts: s.hosts.filter((h) => h.id !== id),
        workloads: s.workloads.filter((w) => w.hostId !== id),
      });
  }
  const hero = (
    <div className="hero">
      <div className="hero-copy">
        <div className="eyebrow light">
          <span className="live-dot" />
          WINDOWS SERVER + SQL SERVER
        </div>
        <h1>
          A clear path beyond
          <br />
          <span>end of support.</span>
        </h1>
        <p>
          Understand your estate. See the cost of staying.
          <br className="desktop-only" /> Build a better business case for moving forward.
        </p>
        <div className="hero-actions">
          <button className="button white" onClick={() => go("inventory")}>
            Build your footprint <ArrowRight size={16} />
          </button>
          <button className="text-button light" onClick={() => go("migration")}>
            Explore modernization <ArrowUpRight size={15} />
          </button>
        </div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <div className="orb orb-one" />
        <div className="orb orb-two" />
        <div className="glass-stack stack-a">
          <Server size={27} />
          <span>YOUR ESTATE</span>
          <b>{hostCount} hosts</b>
          <small>{vmCount} operating environments</small>
        </div>
        <div className="flow-line" />
        <div className="glass-stack stack-b">
          <Cloud size={32} />
          <span>YOUR NEXT CHAPTER</span>
          <b>Azure SQL</b>
          <small>Managed Instance</small>
        </div>
        <div className="floating-check">
          <Check size={17} />
        </div>
      </div>
    </div>
  );
  return (
    <>
      <div className="esu-root">
        <div className="esu-navbar">
          <nav className="esu-subnav">
            {navs.map(([id, label, Icon]) => (
              <button key={id} onClick={() => go(id)} className={tab === id ? "active" : ""}>
                <Icon size={16} />
                <span>{label}</span>
                {id === "migration" && <span className="nav-new">MI</span>}
              </button>
            ))}
          </nav>
          <div className="esu-top-actions">
            <span className="saved">
              <span /> {loaded ? "Saved in this browser" : "Loading"}
            </span>
            <button
              className="button small secondary"
              onClick={() => download("ESU-Compass-Scenario.json", JSON.stringify(s, null, 2))}
            >
              <Download size={15} />
              <span>Export scenario</span>
            </button>
            <button className="button small primary" onClick={() => window.print()}>
              <FileText size={15} />
              <span>Customer report</span>
            </button>
          </div>
        </div>
        <main>
          <div className="workspace-bar">
            <div className="customer-name">
              <span className="avatar">{s.customer.slice(0, 1) || "C"}</span>
              <input
                aria-label="Customer name"
                value={s.customer}
                onChange={(e) => update({ customer: e.target.value })}
              />
              {s.sample && <Badge tone="blue">Example estate</Badge>}
            </div>
            <div className="period-controls">
              <Field label="Enrollment / forecast start">
                <input
                  type="date"
                  value={s.start}
                  onChange={(e) => e.target.value && update({ start: e.target.value })}
                />
              </Field>
              <Field label="Planning horizon">
                <select
                  value={s.months}
                  onChange={(e) => update({ months: Number(e.target.value) })}
                >
                  {[1, 3, 6, 9, 12, 18, 24, 36, 48, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} months
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
          {s.sample && (
            <div className="sample-banner">
              <span>
                <Sparkles size={15} />
                Explore a sample footprint, then add your customer’s environment.
              </span>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Start an empty customer scenario? Export first to keep the sample edits.",
                    )
                  ) {
                    setS(initialState(false));
                    go("inventory");
                  }
                }}
              >
                Start a new estimate <ArrowRight size={14} />
              </button>
            </div>
          )}
          {tab === "overview" && (
            <>
              {hero}
              <div className="metric-grid">
                <Metric
                  label={`${s.months}-month Arc ESU forecast`}
                  value={money(arc.total)}
                  caption={
                    arc.complete
                      ? "ESU + catch-up + SQL PAYG"
                      : "Known subtotal · items need review"
                  }
                  icon={<Wallet size={18} />}
                />
                <Metric
                  label="Catch-up at enrollment"
                  value={money(arc.catchup + arc.prior)}
                  caption={
                    arc.prior > 0
                      ? "Includes quoted prior-year coverage"
                      : "Separate from future recurring fees"
                  }
                  icon={<RefreshCw size={18} />}
                />
                <Metric
                  label="Operating environments"
                  value={nf(vmCount)}
                  caption={`${hostCount} physical hosts · ${sqlCount} SQL environments`}
                  icon={<Layers3 size={18} />}
                />
                <Metric
                  label="Potential migration savings"
                  value={mig.complete ? money(mig.savings) : "Needs review"}
                  caption={`${s.months}-month MI scenario · before tax`}
                  icon={<ArrowUpRight size={18} />}
                  tone="accent"
                />
              </div>
              <div className="overview-grid">
                <section className="panel forecast-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Your cost trajectory</h2>
                      <p>Azure Arc · actual UTC hours within each month</p>
                    </div>
                    <Badge tone="blue">USD</Badge>
                  </div>
                  <Chart data={arc.months} />
                  <div className="chart-legend">
                    <span>
                      <i className="blue" />
                      Recurring ESU
                    </span>
                    <span>
                      <i className="amber" />
                      Catch-up / prior years
                    </span>
                    <span>
                      <i className="teal" />
                      SQL PAYG license
                    </span>
                  </div>
                  <div className="panel-bottom">
                    <span>
                      {dayLabel(s.start)} – {dayLabel(addDays(arc.end, -1))}
                    </span>
                    <button className="text-button" onClick={() => go("costs")}>
                      View breakdown <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
                <section className="panel migration-teaser">
                  <div className="teaser-icon">
                    <Database size={23} />
                  </div>
                  <Badge tone="green">PRIORITY PATH</Badge>
                  <h2>
                    Modernize with
                    <br />
                    Managed Instance.
                  </h2>
                  <p>
                    Replace legacy SQL ESU costs with an evergreen Azure SQL service. Model the
                    complete move.
                  </p>
                  <div className="teaser-price">
                    <span>Estimated Azure target</span>
                    <strong>
                      {money(mc.monthly)}
                      <small>/ month</small>
                    </strong>
                  </div>
                  <button className="button primary" onClick={() => go("migration")}>
                    Build the business case <ArrowRight size={16} />
                  </button>
                </section>
              </div>
              <div className="section-title top-space">
                <div>
                  <h2>Make your estimate customer-ready</h2>
                  <p className="muted">Three steps from infrastructure to an informed decision.</p>
                </div>
                <button className="text-button" onClick={() => go("sources")}>
                  Methodology <ArrowUpRight size={14} />
                </button>
              </div>
              <div className="steps">
                <button onClick={() => go("inventory")}>
                  <span>01</span>
                  <div>
                    <h3>Map your footprint</h3>
                    <p>Hosts, VMs, versions and license rights</p>
                  </div>
                  <ArrowUpRight />
                </button>
                <button onClick={() => go("rates")}>
                  <span>02</span>
                  <div>
                    <h3>Confirm your agreement</h3>
                    <p>SA, annual quotes, discounts and rates</p>
                  </div>
                  <ArrowUpRight />
                </button>
                <button onClick={() => go("migration")}>
                  <span>03</span>
                  <div>
                    <h3>Compare your next move</h3>
                    <p>ESU retention, Azure SQL and upgrades</p>
                  </div>
                  <ArrowUpRight />
                </button>
              </div>
              <Notice tone="warn">
                <strong>2026 licensing change:</strong> Windows Server 2016 and SQL Server 2016 ESU
                remains paid on Azure and Azure Local. Windows Server 2012/R2 ESU has ended.{" "}
                <button className="inline-link" onClick={() => go("sources")}>
                  Review the rules
                </button>
              </Notice>
              {allIssues.length > 0 && (
                <button className="review-strip" onClick={() => go("costs")}>
                  <AlertTriangle size={17} />
                  <strong>{allIssues.length} items to review</strong>
                  <span>Complete license rights, pricing, and coverage assumptions.</span>
                  <ArrowRight size={16} />
                </button>
              )}
            </>
          )}
          {tab === "inventory" && (
            <>
              <PageHeading
                eyebrow="01 / YOUR ENVIRONMENT"
                title="Every host. Every workload."
                description="Map the physical infrastructure and the operating environments inside it."
              />
              <div className="toolbar">
                <div className="searchbox">
                  <Search size={17} />
                  <input
                    placeholder="Find a host or workload…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex">
                  <button className="button secondary" onClick={() => jsonInput.current?.click()}>
                    <FolderOpen size={16} />
                    Open scenario
                  </button>
                  <button className="button secondary" onClick={() => csvInput.current?.click()}>
                    <Upload size={16} />
                    Import CSV
                  </button>
                  <button className="button primary" onClick={() => setHostEdit(newHost())}>
                    <Plus size={17} />
                    Add host
                  </button>
                </div>
              </div>
              <div className="inventory-summary">
                <span>
                  <Server size={17} />
                  <strong>{hostCount}</strong> hosts
                </span>
                <span>
                  <Layers3 size={17} />
                  <strong>{vmCount}</strong> OSEs
                </span>
                <span>
                  <Database size={17} />
                  <strong>{sqlCount}</strong> SQL OSEs
                </span>
                <button
                  className="text-button"
                  onClick={() => download("ESU-Inventory-Template.csv", csvTemplate, "text/csv")}
                >
                  Download CSV template <Download size={14} />
                </button>
              </div>
              {s.hosts.length === 0 ? (
                <Empty
                  title="Start with your first host"
                  description="Add physical hosts, then the VMs or bare-metal workloads they run. You can also import your inventory in bulk."
                  action={
                    <button className="button primary" onClick={() => setHostEdit(newHost())}>
                      <Plus size={16} />
                      Add physical host
                    </button>
                  }
                />
              ) : (
                s.hosts
                  .filter(
                    (h) =>
                      h.name.toLowerCase().includes(search.toLowerCase()) ||
                      s.workloads.some(
                        (w) =>
                          w.hostId === h.id && w.name.toLowerCase().includes(search.toLowerCase()),
                      ),
                  )
                  .map((h) => {
                    const ws = s.workloads.filter((w) => w.hostId === h.id);
                    return (
                      <section className="host-card" key={h.id}>
                        <header>
                          <button
                            className="host-heading"
                            onClick={() =>
                              setExpanded({ ...expanded, [h.id]: expanded[h.id] === false })
                            }
                          >
                            {expanded[h.id] === false ? (
                              <ChevronRight size={18} />
                            ) : (
                              <ChevronDown size={18} />
                            )}
                            <div className="host-icon">
                              <Server size={22} />
                            </div>
                            <div>
                              <h3>{h.name}</h3>
                              <p>
                                {h.quantity} {h.quantity === 1 ? "host" : "identical hosts"} ·{" "}
                                {h.sockets} processors × {h.coresPerSocket} cores ·{" "}
                                {h.location === "onprem"
                                  ? "On premises"
                                  : h.location === "azurelocal"
                                    ? "Azure Local"
                                    : h.location === "azure"
                                      ? "Azure"
                                      : "Other cloud"}
                              </p>
                            </div>
                          </button>
                          <div className="flex">
                            <button
                              className="button small secondary"
                              onClick={() => setWorkEdit(newWorkload(h.id))}
                            >
                              <Plus size={14} />
                              Add workload
                            </button>
                            <button
                              className="icon-button"
                              title="Edit host"
                              onClick={() => setHostEdit(h)}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              className="icon-button danger"
                              title="Delete host"
                              onClick={() => removeHost(h.id)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </header>
                        {expanded[h.id] !== false && (
                          <>
                            <div className="host-pills">
                              <span>
                                Windows:{" "}
                                {h.windowsMode === "vm"
                                  ? "per VM"
                                  : h.windowsMode === "datacenter"
                                    ? "physical Datacenter"
                                    : "physical Standard"}
                              </span>
                              <span>
                                SQL: {h.sqlMode === "vm" ? "per OSE" : "physical Enterprise"}
                              </span>
                            </div>
                            {ws.length ? (
                              <div className="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Workload</th>
                                      <th>Footprint</th>
                                      <th>Windows Server</th>
                                      <th>SQL Server</th>
                                      <th>Migration</th>
                                      <th />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ws.map((w) => (
                                      <tr key={w.id}>
                                        <td>
                                          <button
                                            className="name-button"
                                            onClick={() => setWorkEdit(w)}
                                          >
                                            {w.kind === "physical" ? (
                                              <HardDrive size={16} />
                                            ) : (
                                              <Layers3 size={16} />
                                            )}
                                            <strong>{w.name}</strong>
                                          </button>
                                          <small>
                                            {w.kind === "vm" ? "Virtual machine" : "Physical OSE"}
                                          </small>
                                        </td>
                                        <td>
                                          <strong>
                                            {w.quantity * h.quantity}{" "}
                                            {w.kind === "vm" ? "VMs" : "OSEs"}
                                          </strong>
                                          <small>
                                            {w.kind === "vm"
                                              ? `${w.cores} vCores each`
                                              : `${h.sockets * h.coresPerSocket} physical cores`}
                                          </small>
                                        </td>
                                        <td>
                                          {w.osVersion === "none" ? (
                                            <span className="muted">No Windows</span>
                                          ) : (
                                            <>
                                              <strong>
                                                {w.osVersion}{" "}
                                                <span className="muted">{w.osEdition}</span>
                                              </strong>
                                              <LifecycleBadge
                                                family="windows"
                                                version={w.osVersion}
                                                date={s.start}
                                              />
                                            </>
                                          )}
                                        </td>
                                        <td>
                                          {w.sql.length ? (
                                            w.sql.map((sq) => (
                                              <div key={sq.id} className="sql-cell">
                                                <strong>
                                                  {sq.version}{" "}
                                                  <span className="muted">{sq.edition}</span>
                                                </strong>
                                                <LifecycleBadge
                                                  family="sql"
                                                  version={sq.version}
                                                  date={s.start}
                                                />
                                              </div>
                                            ))
                                          ) : (
                                            <span className="muted">—</span>
                                          )}
                                        </td>
                                        <td>
                                          {w.migrate ? (
                                            <Badge tone="blue">SQL Managed Instance</Badge>
                                          ) : (
                                            <span className="muted">Keep in place</span>
                                          )}
                                        </td>
                                        <td>
                                          <button
                                            className="icon-button"
                                            aria-label={"Edit " + w.name}
                                            onClick={() => setWorkEdit(w)}
                                          >
                                            <Pencil size={15} />
                                          </button>
                                          <button
                                            className="icon-button danger"
                                            aria-label={"Delete " + w.name}
                                            onClick={() => {
                                              if (window.confirm("Remove " + w.name + "?"))
                                                update({
                                                  sample: false,
                                                  workloads: s.workloads.filter(
                                                    (x) => x.id !== w.id,
                                                  ),
                                                });
                                            }}
                                          >
                                            <Trash2 size={15} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <Empty
                                title="No workloads yet"
                                description="Add the VMs or productive physical OSE on this host."
                              />
                            )}
                          </>
                        )}
                      </section>
                    );
                  })
              )}
              <Notice>
                Use one host group only for identical configurations and coverage histories. Repeat
                a workload name in CSV to add another SQL version to the same OSE. Import replaces
                the footprint; annual coverage and passive exemptions must be reviewed after import.
              </Notice>
            </>
          )}
          {tab === "costs" && (
            <>
              <PageHeading
                eyebrow="02 / BILLING & COVERAGE"
                title="Know what you are paying for."
                description="Compare flexible Arc billing with annual agreements, including enrollment catch-up."
              />
              <div className="toolbar">
                <div className="segmented">
                  <button
                    className={channel === "arc" ? "selected" : ""}
                    onClick={() => setChannel("arc")}
                  >
                    Azure Arc · monthly
                  </button>
                  <button
                    className={channel === "annual" ? "selected" : ""}
                    onClick={() => setChannel("annual")}
                  >
                    Non-Arc · annual
                  </button>
                </div>
                <button className="button secondary" onClick={exportCSV}>
                  <Download size={16} />
                  Export line items
                </button>
              </div>
              <div className="metric-grid">
                <Metric
                  label="ESU & SQL PAYG subtotal"
                  value={money(e.total)}
                  caption={e.complete ? "Configured forecast" : "Partial · see review items"}
                  icon={<Calculator size={18} />}
                />
                <Metric
                  label="Catch-up / prior years"
                  value={money(e.catchup + e.prior)}
                  caption="Earlier coverage required at enrollment"
                  icon={<RefreshCw size={18} />}
                />
                <Metric
                  label="SA & other entered costs"
                  value={money(extras)}
                  caption="Contract costs entered below"
                  icon={<ShieldCheck size={18} />}
                />
                <Metric
                  label="Total modeled cash cost"
                  value={money((e.total + extras) * (1 + s.tax / 100))}
                  caption={`${s.tax}% tax assumption · ${s.months} months`}
                  icon={<Wallet size={18} />}
                  tone="accent"
                />
              </div>
              <div className="two-col">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>How this channel bills</h2>
                      <p>
                        {channel === "arc"
                          ? "Usage meters, billed through Azure"
                          : "Product-year entitlement, paid in full"}
                      </p>
                    </div>
                  </div>
                  {channel === "arc" ? (
                    <div className="plain-content">
                      <p>
                        <strong>Windows Server:</strong> activated license cores are billed, even
                        with no servers linked. This forecast uses Microsoft’s hourly retail meter.
                        Partial periods remain invoice estimates.
                      </p>
                      <p>
                        <strong>SQL Server:</strong> hourly meters with a 4-core minimum per OSE.
                        Late enrollment catches up to the start of the current ESU year; missing
                        earlier years need quoted coverage.
                      </p>
                      <p>
                        Back-billing is shown at enrollment for planning. Actual invoice timing
                        follows the Azure billing account. Reductions to Windows licensing can take
                        up to five days.
                      </p>
                    </div>
                  ) : (
                    <div className="plain-content">
                      <p>
                        Each ESU year is purchased in full. Starting halfway through a program year
                        does not prorate the fee. Earlier years must be purchased if not already
                        covered.
                      </p>
                      <p>
                        Enter an annual rate for each version, edition and program year in{" "}
                        <button className="inline-link" onClick={() => go("rates")}>
                          Rates & agreements
                        </button>
                        . Blank prices remain unknown.
                      </p>
                      <p>
                        Annual Windows ESU must match the underlying license basis and edition. SQL
                        Server+CAL and special agreements need a licensing quote before inclusion.
                      </p>
                    </div>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Forecast composition</h2>
                      <p>
                        {e.complete
                          ? "Based on entered entitlements"
                          : "Known amounts only; review unresolved items"}
                      </p>
                    </div>
                  </div>
                  <div className="plain-content">
                    <Breakdown
                      label="Future ESU charges"
                      value={money(e.recurring + e.annual, 2)}
                    />
                    <Breakdown label="Current-year catch-up" value={money(e.catchup, 2)} />
                    <Breakdown label="Quoted prior ESU years" value={money(e.prior, 2)} />
                    <Breakdown label="SQL base PAYG licensing" value={money(e.base, 2)} />
                    <Breakdown label="Additional entered costs" value={money(extras, 2)} />
                    <Breakdown
                      label="Modeled total before tax"
                      value={money(e.total + extras, 2)}
                      bold
                    />
                  </div>
                </section>
              </div>
              <section className="panel top-space">
                <div className="panel-heading">
                  <div>
                    <h2>License quantity audit</h2>
                    <p>
                      Every charge traces to a version, edition, core basis and coverage history.
                    </p>
                  </div>
                  <Badge>{e.lines.length} license groups</Badge>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>License group</th>
                        <th>Version / edition</th>
                        <th>Billable basis</th>
                        <th>Price basis</th>
                        <th>Known charges</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.lines.map((l) => (
                        <tr key={l.id}>
                          <td>
                            <strong>{l.label}</strong>
                            <small>{l.family === "sql" ? "SQL Server" : "Windows Server"}</small>
                          </td>
                          <td>
                            {l.version}
                            <small>{l.edition}</small>
                          </td>
                          <td>
                            <strong>{nf(l.units)}</strong>
                            <small>{l.unitLabel}</small>
                          </td>
                          <td>
                            {l.free
                              ? "Verified free benefit"
                              : channel === "arc"
                                ? l.rate !== null
                                  ? `$${l.rate} / core-hour`
                                  : "Rate required"
                                : "Annual quote / core"}
                            <small>
                              {l.coverage.mode === "new"
                                ? "New enrollment"
                                : l.coverage.mode === "arc"
                                  ? "Existing Arc"
                                  : "Annual coverage"}
                            </small>
                          </td>
                          <td>
                            <strong>
                              {money(
                                e.charges
                                  .filter((c) => c.lineId === l.id)
                                  .reduce((n, c) => n + c.amount, 0),
                                2,
                              )}
                            </strong>
                          </td>
                          <td>
                            <Badge
                              tone={
                                !l.eligibility
                                  ? "red"
                                  : l.status === "expired"
                                    ? "red"
                                    : l.status === "supported"
                                      ? "green"
                                      : "blue"
                              }
                            >
                              {!l.eligibility
                                ? "Ineligible / review"
                                : l.free
                                  ? "Free benefit"
                                  : l.status === "expired"
                                    ? "Coverage ended"
                                    : l.status === "supported"
                                      ? "Not yet required"
                                      : "ESU"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!e.lines.length && (
                    <Empty
                      title="No licensed workloads"
                      description="Add your environment to calculate ESU costs."
                    />
                  )}
                </div>
              </section>
              <section className="panel top-space">
                <div className="panel-heading">
                  <div>
                    <h2>Monthly cash-flow estimate</h2>
                    <p>
                      Charges are assigned to forecast months, not accounting amortization periods.
                    </p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Recurring ESU</th>
                        <th>Catch-up + prior</th>
                        <th>Annual purchase</th>
                        <th>SQL PAYG</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.months.map((m, i) => (
                        <tr key={i}>
                          <td>{m.label}</td>
                          <td>{money(m.esu, 2)}</td>
                          <td>{money(m.catchup, 2)}</td>
                          <td>{money(m.annual, 2)}</td>
                          <td>{money(m.base, 2)}</td>
                          <td>
                            <strong>{money(m.total, 2)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel top-space">
                <div className="panel-heading">
                  <div>
                    <h2>Complete the cost picture</h2>
                    <p>Use actual contract costs. Software Assurance is separate from ESU.</p>
                  </div>
                </div>
                <div className="form-grid four plain-content">
                  <Field label="Existing SA / subscriptions · $/month">
                    <NumberInput
                      value={s.costs.saMonthly}
                      onChange={(n) => update({ costs: { ...s.costs, saMonthly: n || 0 } })}
                    />
                  </Field>
                  <Field label="Other infrastructure / services · $/month">
                    <NumberInput
                      value={s.costs.otherMonthly}
                      onChange={(n) => update({ costs: { ...s.costs, otherMonthly: n || 0 } })}
                    />
                  </Field>
                  <Field label="One-time license / contract costs · $">
                    <NumberInput
                      value={s.costs.oneTime}
                      onChange={(n) => update({ costs: { ...s.costs, oneTime: n || 0 } })}
                    />
                  </Field>
                  <Field label="Optional tax assumption · %">
                    <NumberInput
                      value={s.tax}
                      onChange={(n) => update({ tax: Math.min(100, n || 0) })}
                    />
                  </Field>
                </div>
                <p className="panel-footnote">
                  Recurring non-ESU costs use hours ÷ 730. Enter only costs not already included in
                  SQL PAYG meters; zero means excluded by assumption.
                </p>
              </section>
              <ReviewItems items={[...e.missing, ...e.coverageGaps, ...e.warnings]} />
            </>
          )}
          {tab === "migration" && (
            <>
              <PageHeading
                eyebrow="03 / MODERNIZATION"
                title="Make the move make sense."
                description="Prioritize Azure SQL Managed Instance, with a transparent cost and savings model."
              />
              <div className="migration-header">
                <div>
                  <Badge tone="green">
                    <Database size={13} />
                    PRIORITY STRATEGY
                  </Badge>
                  <h2>Azure SQL Managed Instance</h2>
                  <p>
                    An evergreen SQL platform. No legacy SQL ESU subscription at the destination.
                  </p>
                </div>
                <a
                  className="button secondary"
                  href="https://learn.microsoft.com/en-us/azure/migrate/tutorial-assess-sql"
                  target="_blank"
                  rel="noreferrer"
                >
                  Validate with Azure Migrate <ExternalLink size={15} />
                </a>
              </div>
              <div className="migration-layout">
                <div className="migration-forms">
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          <span className="number-dot">1</span>Choose the workloads
                        </h2>
                        <p>Select the SQL environments to consolidate into the target below.</p>
                      </div>
                    </div>
                    <div className="plain-content">
                      {s.workloads
                        .filter((w) => w.sql.length)
                        .map((w) => (
                          <div className="migration-workload" key={w.id}>
                            <Toggle
                              checked={w.migrate}
                              onChange={(v) =>
                                update({
                                  workloads: s.workloads.map((x) =>
                                    x.id === w.id ? { ...x, migrate: v } : x,
                                  ),
                                })
                              }
                            >
                              <strong>{w.name}</strong>
                              <small>
                                {w.quantity *
                                  (s.hosts.find((h) => h.id === w.hostId)?.quantity || 1)}{" "}
                                OSEs · SQL {w.sql.map((sq) => sq.version).join(", ")}
                              </small>
                            </Toggle>
                            {w.migrate && (
                              <Toggle
                                checked={w.retireOS}
                                onChange={(v) =>
                                  update({
                                    workloads: s.workloads.map((x) =>
                                      x.id === w.id ? { ...x, retireOS: v } : x,
                                    ),
                                  })
                                }
                              >
                                Retire Windows OS too
                              </Toggle>
                            )}
                          </div>
                        ))}
                      {!sqlCount && (
                        <p>Add a SQL workload in your footprint to compare migration costs.</p>
                      )}
                      <div className="form-grid top-space">
                        <Field label="Cutover date">
                          <input
                            type="date"
                            value={s.mi.cutover}
                            onChange={(e) =>
                              e.target.value && updateMI({ cutover: e.target.value })
                            }
                          />
                        </Field>
                        <Field label="Azure overlap before cutover · months">
                          <NumberInput
                            value={s.mi.overlapMonths}
                            onChange={(n) => updateMI({ overlapMonths: Math.min(24, n || 0) })}
                          />
                        </Field>
                        <Field
                          label="Windows deactivation lag · days"
                          hint="Azure billing reductions can take up to 5 days."
                        >
                          <NumberInput
                            value={s.mi.windowsLagDays}
                            step="1"
                            onChange={(n) =>
                              updateMI({ windowsLagDays: Math.min(5, Math.round(n || 0)) })
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          <span className="number-dot">2</span>Design the Azure target
                        </h2>
                        <p>Target sizing is an input, not a prediction from source core counts.</p>
                      </div>
                    </div>
                    <div className="plain-content">
                      <div className="form-grid">
                        <Field
                          label="Azure region"
                          hint="Refresh rates on the Rates & agreements page."
                        >
                          <input readOnly value={regionNames[s.prices.region] || s.prices.region} />
                        </Field>
                        <Field label="Service tier">
                          <select
                            value={s.mi.tier}
                            onChange={(e) => updateMI({ tier: e.target.value as MI["tier"] })}
                          >
                            <option value="gp">General Purpose · Gen5</option>
                            <option value="bc">Business Critical · Gen5</option>
                          </select>
                        </Field>
                        <Field label="Target instance count">
                          <NumberInput
                            value={s.mi.instances}
                            min={1}
                            step="1"
                            onChange={(n) =>
                              updateMI({ instances: Math.max(1, Math.round(n || 1)) })
                            }
                          />
                        </Field>
                        <Field label="vCores per instance">
                          <select
                            value={s.mi.vcores}
                            onChange={(e) => updateMI({ vcores: Number(e.target.value) })}
                          >
                            {[4, 8, 16, 24, 32, 40, 64, 80].map((n) => (
                              <option key={n}>{n}</option>
                            ))}
                          </select>
                        </Field>
                        <Field
                          label="Provisioned storage GB / instance"
                          hint="Rounded up to 32 GB; first 32 GB excluded."
                        >
                          <NumberInput
                            value={s.mi.storageGB}
                            min={32}
                            step="32"
                            onChange={(n) => updateMI({ storageGB: n || 32 })}
                          />
                        </Field>
                        <Field
                          label="Billable excess LRS backup GB / instance"
                          hint="Enter only backup storage above the included allowance."
                        >
                          <NumberInput
                            value={s.mi.backupGB}
                            onChange={(n) => updateMI({ backupGB: n || 0 })}
                          />
                        </Field>
                        <Field label="Compute purchase option">
                          <select
                            value={s.mi.term}
                            onChange={(e) =>
                              updateMI({
                                term: e.target.value as MI["term"],
                                computeOverride: null,
                              })
                            }
                          >
                            <option value="payg">Pay as you go</option>
                            <option value="one">1-year reservation · upfront</option>
                            <option value="three">3-year reservation · upfront</option>
                          </select>
                        </Field>
                      </div>
                      <Toggle checked={s.mi.zone} onChange={(v) => updateMI({ zone: v })}>
                        Add zone redundancy (compute add-on + ZRS data storage)
                      </Toggle>
                      <Toggle checked={s.mi.readiness} onChange={(v) => updateMI({ readiness: v })}>
                        Compatibility, sizing and regional availability verified with Azure Migrate
                      </Toggle>
                      {!s.mi.readiness && (
                        <p className="small amber-text">
                          Sizing is provisional. Validate CPU, memory, IOPS, SQL features, storage
                          limits and dependencies before committing.
                        </p>
                      )}
                      <details>
                        <summary>
                          Customer price overrides <ChevronDown size={15} />
                        </summary>
                        <div className="form-grid">
                          <Field
                            label={
                              s.mi.term === "payg"
                                ? "Compute $ / vCore-hour"
                                : "Full reservation $ / vCore for term"
                            }
                          >
                            <NumberInput
                              value={s.mi.computeOverride}
                              onChange={(n) => updateMI({ computeOverride: n })}
                              placeholder="Use Microsoft retail"
                            />
                          </Field>
                          <Field label="SQL license $ / vCore-hour">
                            <NumberInput
                              value={s.mi.licenseOverride}
                              onChange={(n) => updateMI({ licenseOverride: n })}
                              placeholder="Use Microsoft retail"
                            />
                          </Field>
                          <Field label="Storage $ / GB-month">
                            <NumberInput
                              value={s.mi.storageOverride}
                              onChange={(n) => updateMI({ storageOverride: n })}
                              placeholder="Use Microsoft retail"
                            />
                          </Field>
                          <Field label="Excess backup $ / GB-month">
                            <NumberInput
                              value={s.mi.backupOverride}
                              onChange={(n) => updateMI({ backupOverride: n })}
                              placeholder="Use Microsoft retail"
                            />
                          </Field>
                        </div>
                      </details>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          <span className="number-dot">3</span>Apply license benefits
                        </h2>
                        <p>Keep Software Assurance and license allocations explicit.</p>
                      </div>
                    </div>
                    <div className="plain-content">
                      <Toggle checked={s.mi.ahb} onChange={(v) => updateMI({ ahb: v })}>
                        Use Azure Hybrid Benefit for SQL Server
                      </Toggle>
                      {s.mi.ahb && (
                        <>
                          <div className="form-grid top-space">
                            <Field label="Eligible license edition">
                              <select
                                value={s.mi.ahbEdition}
                                onChange={(e) =>
                                  updateMI({ ahbEdition: e.target.value as MI["ahbEdition"] })
                                }
                              >
                                <option>Enterprise</option>
                                <option>Standard</option>
                              </select>
                            </Field>
                            <Field label="Eligible SQL core licenses allocated">
                              <NumberInput
                                value={s.mi.ahbCores}
                                onChange={(n) => updateMI({ ahbCores: n || 0 })}
                              />
                            </Field>
                          </div>
                          <Toggle
                            checked={s.mi.ahbConfirmed}
                            onChange={(v) => updateMI({ ahbConfirmed: v })}
                          >
                            Active SA/subscription and allocation rights confirmed; no disallowed
                            double-use
                          </Toggle>
                          <Notice tone={mc.ahbValid ? "success" : "warn"}>
                            {mc.requiredCores} eligible {s.mi.ahbEdition} core licenses are required
                            for {mc.totalCores} target vCores.{" "}
                            {mc.ahbValid
                              ? "Base-price licensing is applied."
                              : "License-included pricing stays in the estimate until eligible coverage is confirmed."}
                          </Notice>
                          {(s.mi.overlapMonths * 730) / 24 > 180 && (
                            <Notice tone="warn">
                              Planned overlap exceeds the 180-day AHB migration allowance.
                              Additional licenses may be needed.
                            </Notice>
                          )}
                        </>
                      )}
                      <div className="form-grid top-space">
                        <Field
                          label="Retained / new Azure SA · $/month"
                          hint="SA supporting AHB is not free."
                        >
                          <NumberInput
                            value={s.mi.saMonthly}
                            onChange={(n) => updateMI({ saMonthly: n || 0 })}
                          />
                        </Field>
                        <Field
                          label="Azure extras · $/month"
                          hint="Networking, Defender, support, secondary DR, IOPS, LTR and services."
                        >
                          <NumberInput
                            value={s.mi.extrasMonthly}
                            onChange={(n) => updateMI({ extrasMonthly: n || 0 })}
                          />
                        </Field>
                      </div>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          <span className="number-dot">4</span>Capture the cost of change
                        </h2>
                        <p>Only count costs that can actually be removed after migration.</p>
                      </div>
                    </div>
                    <div className="plain-content">
                      <div className="form-grid">
                        <Field label="Migration project · one-time $">
                          <NumberInput
                            value={s.mi.migrationCost}
                            onChange={(n) => updateMI({ migrationCost: n || 0 })}
                          />
                        </Field>
                        <Field
                          label="Avoidable infrastructure / operations · $/month"
                          hint={`Current total entered: ${money(s.costs.otherMonthly)} / month`}
                        >
                          <NumberInput
                            value={s.mi.baselineAvoidableMonthly}
                            onChange={(n) => updateMI({ baselineAvoidableMonthly: n || 0 })}
                          />
                        </Field>
                        <Field
                          label="Avoidable current SA / subscriptions · $/month"
                          hint={`Current total entered: ${money(s.costs.saMonthly)} / month`}
                        >
                          <NumberInput
                            value={s.mi.baselineSaMonthly}
                            onChange={(n) => updateMI({ baselineSaMonthly: n || 0 })}
                          />
                        </Field>
                      </div>
                      <Toggle
                        checked={s.mi.baselineReviewed}
                        onChange={(v) => updateMI({ baselineReviewed: v })}
                      >
                        Baseline operating costs, migration cost and Azure extras have been reviewed
                      </Toggle>
                      {(s.mi.baselineAvoidableMonthly > s.costs.otherMonthly ||
                        s.mi.baselineSaMonthly > s.costs.saMonthly) && (
                        <Notice tone="warn">
                          Avoidable costs exceed the current baseline. Update the baseline in ESU
                          cost analysis before using the savings result.
                        </Notice>
                      )}
                    </div>
                  </section>
                </div>
                <aside className="business-case">
                  <section className="panel result-panel">
                    <div className="result-heading">
                      <span className="eyebrow">YOUR BUSINESS CASE</span>
                      <Badge tone={mig.complete ? "green" : "amber"}>
                        {mig.complete ? "Modeled estimate" : "Incomplete"}
                      </Badge>
                    </div>
                    <p className="muted">Potential {s.months}-month savings</p>
                    <div className={"savings " + (mig.savings < 0 ? "negative" : "")}>
                      {mig.complete ? money(mig.savings) : "Needs review"}
                    </div>
                    <p className="small muted">
                      {mig.complete
                        ? mig.savings >= 0
                          ? "Estimated reduction against the configured baseline."
                          : "The configured target costs more over this horizon."
                        : "Resolve coverage and rate gaps to establish a comparable total."}
                    </p>
                    <div className="comparison-bars">
                      <div>
                        <span>Keep current estate</span>
                        <b>{money(mig.current)}</b>
                        <i style={{ width: "100%" }} />
                      </div>
                      <div className="azure">
                        <span>Move selected SQL to MI</span>
                        <b>{money(mig.target)}</b>
                        <i
                          style={{
                            width:
                              Math.min(
                                100,
                                Math.max(4, (mig.target / Math.max(1, mig.current)) * 100),
                              ) + "%",
                          }}
                        />
                      </div>
                    </div>
                    <Breakdown label="Avoided future ESU" value={money(mig.esuAvoided)} />
                    <Breakdown label="Remaining ESU & catch-up" value={money(mig.residual.total)} />
                    <Breakdown label="MI charges within horizon" value={money(mig.miRun)} />
                    <Breakdown
                      label="Remaining baseline costs"
                      value={money(mig.retainedOperations)}
                    />
                    <Breakdown label="Migration project" value={money(mig.oneTime)} />
                    <Breakdown label="Total target scenario" value={money(mig.target)} bold />
                    <p className="small muted">
                      Azure Arc baseline, before tax. Sunk annual purchases and prior coverage are
                      not refunded. Arc licenses must actually be reduced or deactivated.
                    </p>
                    {(!s.mi.baselineReviewed || !s.mi.readiness) && (
                      <div className="estimate-note">
                        Provisional business case:{" "}
                        {(!s.mi.baselineReviewed ? "cost assumptions" : "") +
                          (!s.mi.baselineReviewed && !s.mi.readiness ? " and " : "") +
                          (!s.mi.readiness ? "target sizing" : "")}{" "}
                        need confirmation.
                      </div>
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Azure monthly run rate</h2>
                        <p>
                          {s.mi.instances} × {s.mi.vcores}-vCore{" "}
                          {s.mi.tier === "gp" ? "General Purpose" : "Business Critical"}
                        </p>
                      </div>
                    </div>
                    <div className="plain-content">
                      <Breakdown label="Compute" value={money(mc.compute, 2)} />
                      <Breakdown label="SQL licensing" value={money(mc.license, 2)} />
                      <Breakdown label="Zone compute add-on" value={money(mc.zone, 2)} />
                      <Breakdown label="Data storage" value={money(mc.storage, 2)} />
                      <Breakdown label="Excess LRS backup" value={money(mc.backup, 2)} />
                      <Breakdown
                        label="SA + Azure extras"
                        value={money(s.mi.saMonthly + s.mi.extrasMonthly, 2)}
                      />
                      <Breakdown label="Monthly estimate" value={money(mc.monthly, 2)} bold />
                      <p className="small muted">
                        730-hour month.{" "}
                        {s.mi.term !== "payg"
                          ? `Compute is amortized here; the full ${money(mc.commitment)} reservation commitment is included in the business-case cash cost.`
                          : "Actual Azure compute charges follow usage hours."}
                      </p>
                    </div>
                  </section>
                  {mc.missing.map((m, i) => (
                    <Notice key={i} tone="warn">
                      {m}
                    </Notice>
                  ))}
                  {mig.partialPools.map((m, i) => (
                    <Notice key={i} tone="warn">
                      {m}
                    </Notice>
                  ))}
                </aside>
              </div>
              <AlternativeStrategies state={s} updateMI={updateMI} />
              <Notice>
                Managed Instance removes legacy SQL ESU at the destination. It does not
                automatically retire Windows application servers or remove shared physical-host ESU.
                Prices are for public Azure Gen5; next-generation tiers, savings plans, instance
                pools and specialized offers require a matching customer quote.
              </Notice>
            </>
          )}
          {tab === "rates" && (
            <>
              <PageHeading
                eyebrow="PRICE BOOK / USD"
                title="Real meters. Your agreement."
                description="Trace public pricing to Microsoft, or replace it with a verified customer rate."
              />
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Azure retail price book</h2>
                    <p>
                      Retrieved {s.prices.checked} ·{" "}
                      {regionNames[s.prices.region] || s.prices.region} · public Azure · USD
                    </p>
                  </div>
                  <Badge tone="blue">{Object.keys(s.prices.meters).length} exact meters</Badge>
                </div>
                <div className="price-refresh">
                  <Field label="Azure region">
                    <select value={rateRegion} onChange={(e) => setRateRegion(e.target.value)}>
                      {Object.entries(regionNames).map(([id, n]) => (
                        <option key={id} value={id}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button className="button primary" disabled={refreshing} onClick={refreshRates}>
                    <RefreshCw size={16} className={refreshing ? "spin" : ""} />
                    {refreshing ? "Retrieving Microsoft rates…" : "Refresh Microsoft rates"}
                  </button>
                  <p>
                    Refresh replaces hourly overrides.
                    <br />
                    Annual agreement quotes are retained.
                  </p>
                </div>
                <div className="plain-content">
                  <Toggle
                    checked={s.eligibilityConfirmed}
                    onChange={(v) => update({ eligibilityConfirmed: v })}
                  >
                    Required SA/subscription and CAL/connector coverage is confirmed (or not
                    applicable), and workloads meet service-pack prerequisites
                  </Toggle>
                  <p className="small muted">
                    CAL and external connector SA costs belong in the current-cost inputs. ESU does
                    not replace those rights or an underlying product license.
                  </p>
                </div>
                <div className="form-grid three plain-content">
                  <Field label="Recurring Arc discount · %">
                    <NumberInput
                      value={s.discount}
                      onChange={(n) => update({ discount: Math.min(100, n || 0) })}
                    />
                  </Field>
                  <Field
                    label="Catch-up discount · %"
                    hint="Do not assume recurring discounts apply to catch-up."
                  >
                    <NumberInput
                      value={s.backDiscount}
                      onChange={(n) => update({ backDiscount: Math.min(100, n || 0) })}
                    />
                  </Field>
                  <Field label="Annual quote discount · %">
                    <NumberInput
                      value={s.annualDiscount}
                      onChange={(n) => update({ annualDiscount: Math.min(100, n || 0) })}
                    />
                  </Field>
                </div>
              </section>
              <section className="panel top-space">
                <div className="panel-heading">
                  <div>
                    <h2>Annual agreement quotes</h2>
                    <p>
                      USD per licensed core for the full program year. Leave unquoted years blank.
                    </p>
                  </div>
                  <a
                    className="text-button"
                    href="https://www.microsoft.com/en-us/windows-server/extended-security-updates"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Microsoft ESU options <ExternalLink size={14} />
                  </a>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Product / edition</th>
                        <th>Year 1 · $/core</th>
                        <th>Year 2 · $/core</th>
                        <th>Year 3 · $/core</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        "windows-2012-Standard",
                        "windows-2012-Datacenter",
                        "windows-2016-Standard",
                        "windows-2016-Datacenter",
                        "sql-2014-Standard",
                        "sql-2014-Enterprise",
                        "sql-2016-Standard",
                        "sql-2016-Enterprise",
                      ].map((k) => (
                        <tr key={k}>
                          <td>
                            <strong>
                              {k
                                .replace("windows", "Windows Server")
                                .replace("sql", "SQL Server")
                                .split("-")
                                .join(" ")}
                            </strong>
                            <small>
                              {k.includes("2012")
                                ? "Historical / expired program"
                                : "Agreement-specific rates"}
                            </small>
                          </td>
                          {[0, 1, 2].map((y) => (
                            <td key={y}>
                              <NumberInput
                                value={s.prices.annual[k]?.[y] ?? null}
                                placeholder="Quote required"
                                onChange={(n) => {
                                  const values = [
                                    ...(s.prices.annual[k] || [null, null, null]),
                                  ] as [number | null, number | null, number | null];
                                  values[y] = n;
                                  update({
                                    prices: {
                                      ...s.prices,
                                      annual: { ...s.prices.annual, [k]: values },
                                    },
                                  });
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="panel-footnote">
                  Convert pack prices before entry: 2-core quote ÷ 2; 16-core quote ÷ 16. Do not
                  enter a full-server amount as a per-core rate. No universal annual percentage is
                  assumed for the 2016 programs.
                </p>
              </section>
              <section className="panel top-space">
                <div className="panel-heading">
                  <div>
                    <h2>Meter audit & overrides</h2>
                    <p>
                      Units are preserved. Reservation meter values are full-term prices, not hourly
                      charges.
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      download("ESU-Price-Book.json", JSON.stringify(s.prices, null, 2))
                    }
                  >
                    Export price book <Download size={14} />
                  </button>
                </div>
                <div className="table-wrap rate-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Meter</th>
                        <th>Unit</th>
                        <th>Price · USD</th>
                        <th>Effective</th>
                        <th>Provenance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(s.prices.meters)
                        .sort((a, b) => a.key.localeCompare(b.key))
                        .map((m) => (
                          <tr key={m.key}>
                            <td>
                              <strong>{m.key}</strong>
                              <small>{m.name}</small>
                              <small className="mono">{m.meterId}</small>
                            </td>
                            <td>
                              {m.key.endsWith("-one")
                                ? "1-year term / core"
                                : m.key.endsWith("-three")
                                  ? "3-year term / core"
                                  : m.unit}
                            </td>
                            <td>
                              <NumberInput
                                value={m.rate}
                                onChange={(n) => {
                                  if (n !== null)
                                    update({
                                      prices: {
                                        ...s.prices,
                                        meters: {
                                          ...s.prices.meters,
                                          [m.key]: { ...m, rate: n, source: "Customer override" },
                                        },
                                      },
                                    });
                                }}
                              />
                            </td>
                            <td>{m.effectiveStart}</td>
                            <td>
                              <Badge tone={m.source === "Customer override" ? "amber" : "blue"}>
                                {m.source}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel top-space plain-content">
                <Field
                  label="Quote references and agreement notes"
                  hint="Include quote date, agreement, SKU, unit, and any special entitlement assumptions."
                >
                  <textarea
                    rows={4}
                    value={s.prices.notes}
                    onChange={(e) => update({ prices: { ...s.prices, notes: e.target.value } })}
                    placeholder="e.g. Customer EA price sheet, quote reference, validity dates…"
                  />
                </Field>
              </section>
              <Notice>
                Public retail rates do not include taxes or negotiated agreements. Rates are not
                guaranteed for future years. Refreshes update price meters; they do not
                automatically revalidate the licensing rule set reviewed October 15, 2026.
              </Notice>
            </>
          )}
          {tab === "sources" && (
            <>
              <PageHeading
                eyebrow="RULEBOOK / VERIFIED OCT 15, 2026"
                title="An estimate you can explain."
                description="Transparent licensing assumptions, lifecycle dates and direct Microsoft sources."
              />
              <div className="segmented section-tabs">
                <button
                  className={rulesTab === "guidance" ? "selected" : ""}
                  onClick={() => setRulesTab("guidance")}
                >
                  How it works
                </button>
                <button
                  className={rulesTab === "lifecycle" ? "selected" : ""}
                  onClick={() => setRulesTab("lifecycle")}
                >
                  Version lifecycle
                </button>
                <button
                  className={rulesTab === "sources" ? "selected" : ""}
                  onClick={() => setRulesTab("sources")}
                >
                  Microsoft sources
                </button>
              </div>
              {rulesTab === "guidance" && (
                <>
                  <div className="two-col">
                    <section className="panel plain-content">
                      <h2>What the estimate includes</h2>
                      <ul className="clean-list">
                        <li>Windows and SQL ESU core quantities by host or OSE</li>
                        <li>Version-specific coverage and enrollment dates</li>
                        <li>Arc recurring charges and current-year catch-up</li>
                        <li>Quoted missing prior years and annual entitlements</li>
                        <li>Additional SQL PAYG licensing where selected</li>
                        <li>Entered SA, infrastructure and one-time costs</li>
                        <li>MI compute, licensing, data and excess backup storage</li>
                        <li>Migration overlap, retirement assumptions and reservations</li>
                      </ul>
                    </section>
                    <section className="panel plain-content">
                      <h2>What makes a complete estimate</h2>
                      <p>
                        Enter every host that can run the workloads, confirm license rights, and
                        supply current agreement quotes. A missing rate is never treated as a
                        confirmed zero.
                      </p>
                      <p>
                        Dollar figures are planning estimates. Your Azure invoice also depends on
                        activation timestamps, meter history, contract terms, tax and actual
                        configuration changes.
                      </p>
                      <p>
                        Inventory stays in this browser. Export JSON for a durable backup or to move
                        a scenario to another device. Only the chosen Azure region is sent when
                        refreshing prices.
                      </p>
                    </section>
                  </div>
                  <section className="panel top-space plain-content">
                    <h2>Known differences in Microsoft documentation</h2>
                    <div className="rule-callout">
                      <strong>SQL Server 2016 start date</strong>
                      <p>
                        The Arc article says July 14; the newer SQL FAQ and lifecycle sequence
                        indicate July 15, 2026 at 00:00 UTC. This model uses July 15. Confirm the
                        actual meter start before using a precise back-bill total.
                      </p>
                    </div>
                    <div className="rule-callout">
                      <strong>Windows Server 2016 program years</strong>
                      <p>
                        Microsoft publishes a January 2027 start and coverage through January 2030.
                        Later exact boundaries are not established in the reviewed sources. January
                        13 anniversary placeholders are used only to illustrate forecasts; later
                        horizons are marked incomplete.
                      </p>
                    </div>
                    <div className="rule-callout">
                      <strong>SQL 2014 end date</strong>
                      <p>
                        The product lifecycle record gives July 12, 2027. One SQL FAQ gives July 8.
                        This model follows the product lifecycle record.
                      </p>
                    </div>
                    <div className="rule-callout">
                      <strong>Standard physical Windows and large SQL OSEs</strong>
                      <p>
                        Windows physical stacking follows full-host passes; an Arc example shows
                        inconsistent counts. SQL Standard uses the documented Arc 24-core cap;
                        larger OSEs are flagged for edition and agreement review.
                      </p>
                    </div>
                  </section>
                  <section className="panel top-space plain-content">
                    <h2>Special agreements and additional options</h2>
                    <p>
                      Server+CAL annual offers, SPLA rights, CSP subscriptions, Azure Government,
                      mixed license pools, disconnection transitions, passive replicas, dev/test
                      offers and unusual migration rights require agreement validation. The planner
                      records these cases and flags unsupported assumptions rather than silently
                      quoting them.
                    </p>
                    <p>
                      MI savings plans, new hardware generations, instance pools, failover pricing
                      and other Azure targets can be evaluated using a current Azure calculator
                      quote. Avoid applying a compute reservation discount to SQL software or
                      storage.
                    </p>
                  </section>
                </>
              )}
              {rulesTab === "lifecycle" && (
                <section className="panel">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Extended support ends</th>
                          <th>ESU final day</th>
                          <th>At forecast date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {programs.map((p) => (
                          <tr key={p.family + p.version}>
                            <td>
                              <strong>
                                {p.family === "windows" ? "Windows Server" : "SQL Server"}{" "}
                                {p.version}
                              </strong>
                            </td>
                            <td>{dayLabel(p.eos)}</td>
                            <td>
                              {p.provisional
                                ? "January 2030 · exact date unconfirmed"
                                : p.end
                                  ? dayLabel(addDays(p.end, -1))
                                  : "ESU offer not assumed"}
                            </td>
                            <td>
                              <LifecycleBadge
                                family={p.family}
                                version={p.version}
                                date={s.start}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="panel-footnote">
                    SQL product lifecycle records are linked in the source list. Supported versions
                    crossing EOS during a forecast require a newly verified ESU offer.
                  </p>
                </section>
              )}
              {rulesTab === "sources" && (
                <div className="source-list">
                  {sources.map(([name, url, description], i) => (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="source-item"
                      key={url}
                    >
                      <span className="source-number">{String(i + 1).padStart(2, "0")}</span>
                      <div>
                        <h3>{name}</h3>
                        <p>{description}</p>
                        <small>{new URL(url).hostname}</small>
                      </div>
                      <ExternalLink size={18} />
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
          <footer className="main-footer">
            <span>
              ESU Compass <i>•</i> Independent Microsoft technology planning
            </span>
            <span>
              USD estimates <i>•</i> Rules: Oct 15, 2026 <i>•</i> Rates: {s.prices.checked}
            </span>
          </footer>
        </main>
        <input
          ref={jsonInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => importFile(e.target.files?.[0], false)}
        />
        <input
          ref={csvInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => importFile(e.target.files?.[0], true)}
        />
        {hostEdit && (
          <HostEditor host={hostEdit} onSave={saveHost} onClose={() => setHostEdit(null)} />
        )}{" "}
        {workEdit && (
          <WorkloadEditor
            workload={workEdit}
            hosts={s.hosts}
            onSave={saveWork}
            onClose={() => setWorkEdit(null)}
          />
        )}
        {toast && (
          <div className="toast" role="status">
            <InfoIcon />
            {toast}
            <button onClick={() => setToast("")} aria-label="Dismiss notification">
              <X size={16} />
            </button>
          </div>
        )}
        <Report state={s} arc={arc} annual={annual} mig={mig} extras={extras} />
      </div>
    </>
  );
}
function InfoIcon() {
  return <CheckCircle2 size={18} />;
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function ReviewItems({ items }: { items: string[] }) {
  return (
    <section className="panel review-panel top-space">
      <div className="panel-heading">
        <div>
          <h2>
            {items.length ? (
              <>
                <AlertTriangle size={18} /> Items to review ({items.length})
              </>
            ) : (
              <>
                <ShieldCheck size={18} /> No detected configuration gaps
              </>
            )}
          </h2>
          <p>License rights and actual invoice amounts still depend on your agreement.</p>
        </div>
      </div>
      {items.length > 0 && (
        <ul>
          {items.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
function AlternativeStrategies({
  state: s,
  updateMI,
}: {
  state: State;
  updateMI: (p: Partial<MI>) => void;
}) {
  const [strategy, setStrategy] = useState("upgrade");
  const base = estimate(s),
    cutoffs: Record<string, string> = {};
  for (const l of base.lines) {
    const all = l.members.every((id) => {
      const w = s.workloads.find((w) => w.id === id);
      return w?.migrate && (l.family === "sql" || w.retireOS);
    });
    if (all && (strategy === "upgrade" || (l.family === "sql" && l.version === "2014")))
      cutoffs[l.id] = addDays(s.mi.cutover, l.family === "windows" ? s.mi.windowsLagDays : 0);
  }
  const next = estimate(s, "arc", cutoffs),
    after = hours(s.mi.cutover < s.start ? s.start : s.mi.cutover, base.end) / 730;
  const total = next.total + s.mi.otherTargetMonthly * after + s.mi.otherMigrationCost;
  return (
    <section className="panel top-space">
      <div className="panel-heading">
        <div>
          <h2>Compare another modernization path</h2>
          <p>A quick ESU + replacement-cost comparison for the same selected workloads.</p>
        </div>
        <Badge>Optional</Badge>
      </div>
      <div className="plain-content">
        <div className="form-grid three">
          <Field label="Strategy">
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="upgrade">Upgrade to supported SQL / Windows</option>
              <option value="azure">Move to Azure VMs / AVS</option>
              <option value="azurelocal">Move to Azure Local</option>
            </select>
          </Field>
          <Field label="Quoted target run cost · $/month">
            <NumberInput
              value={s.mi.otherTargetMonthly}
              onChange={(n) => updateMI({ otherTargetMonthly: n || 0 })}
            />
          </Field>
          <Field label="Project / hardware / new licenses · $">
            <NumberInput
              value={s.mi.otherMigrationCost}
              onChange={(n) => updateMI({ otherMigrationCost: n || 0 })}
            />
          </Field>
        </div>
        <div className="alternative-results">
          <span>
            Future ESU avoided <strong>{money(base.recurring - next.recurring)}</strong>
          </span>
          <span>
            Remaining ESU & license charges <strong>{money(next.total)}</strong>
          </span>
          <span>
            ESU + entered replacement costs <strong>{money(total)}</strong>
          </span>
        </div>
        <p className="small muted">
          {strategy === "upgrade"
            ? "Assumes selected SQL and any selected OS are upgraded to versions supported through the forecast. Confirm application compatibility and upgrade rights."
            : "2016 ESU is still paid in this destination. Only qualifying SQL 2014 ESU is removed; Azure Local requires Azure verification. Infrastructure, software, hardware and connectivity are separate."}{" "}
          This optional view excludes baseline operating costs and transition overlap; use a
          complete quote before comparing overall savings.
        </p>
      </div>
    </section>
  );
}
function Report({
  state: s,
  arc,
  annual,
  mig,
  extras,
}: {
  state: State;
  arc: Estimate;
  annual: Estimate;
  mig: ReturnType<typeof migration>;
  extras: number;
}) {
  return (
    <article id="print-report">
      <div className="report-brand">
        <Brand />
        <strong>ESU Compass</strong>
      </div>
      <h1>{s.customer} — ESU & modernization plan</h1>
      <p>
        {s.sample ? "EXAMPLE ESTATE · " : ""}
        {dayLabel(s.start)} to {dayLabel(addDays(arc.end, -1))} · USD · rules reviewed October 15,
        2026 · prices retrieved {s.prices.checked}
      </p>
      <h2>Cost summary</h2>
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Known cost before tax</th>
            <th>Completeness</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Azure Arc ESU + entered current costs</td>
            <td>{money(arc.total + extras, 2)}</td>
            <td>{arc.complete ? "Configured estimate" : "Partial / review required"}</td>
          </tr>
          <tr>
            <td>Annual ESU + entered current costs</td>
            <td>{money(annual.total + extras, 2)}</td>
            <td>{annual.complete ? "Configured estimate" : "Quotes / review required"}</td>
          </tr>
          <tr>
            <td>Managed Instance migration scenario</td>
            <td>{money(mig.target, 2)}</td>
            <td>
              {mig.complete
                ? "Modeled; sizing and cost assumptions need verification"
                : "Incomplete comparison"}
            </td>
          </tr>
          <tr>
            <td>Potential migration savings</td>
            <td>{mig.complete ? money(mig.savings, 2) : "Not established"}</td>
            <td>Only entered avoidable costs are credited</td>
          </tr>
        </tbody>
      </table>
      <h2>Environment and license quantities</h2>
      <table>
        <thead>
          <tr>
            <th>Workload / pool</th>
            <th>Product</th>
            <th>Edition</th>
            <th>Core basis</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {arc.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.label}</td>
              <td>
                {l.family} {l.version}
              </td>
              <td>{l.edition}</td>
              <td>
                {l.units} {l.unitLabel}
              </td>
              <td>
                {l.status}
                {l.free ? " / free benefit" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Arc monthly charges</h2>
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th>ESU</th>
            <th>Catch-up / prior</th>
            <th>SQL PAYG</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {arc.months.map((m) => (
            <tr key={m.date}>
              <td>{m.label}</td>
              <td>{money(m.esu, 2)}</td>
              <td>{money(m.catchup, 2)}</td>
              <td>{money(m.base, 2)}</td>
              <td>{money(m.total, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Managed Instance assumptions</h2>
      <p>
        {s.mi.instances} instances × {s.mi.vcores} vCores,{" "}
        {s.mi.tier === "gp" ? "General Purpose" : "Business Critical"} Gen5, {s.prices.region}.{" "}
        {s.mi.storageGB} GB provisioned data and {s.mi.backupGB} GB excess LRS backup per instance.
        Cutover: {s.mi.cutover}; overlap: {s.mi.overlapMonths} months. Purchase: {s.mi.term}; AHB{" "}
        {mig.mi.ahbValid ? "confirmed and applied" : "not applied"}.
      </p>
      <p>
        Monthly Azure run rate: {money(mig.mi.monthly, 2)}. Migration cost:{" "}
        {money(s.mi.migrationCost)}. Retained/new Azure SA: {money(s.mi.saMonthly)}/month; extras:{" "}
        {money(s.mi.extrasMonthly)}/month. Baseline entered SA: {money(s.costs.saMonthly)}/month;
        infrastructure/other: {money(s.costs.otherMonthly)}/month. Avoidable costs:{" "}
        {money(s.mi.baselineAvoidableMonthly + s.mi.baselineSaMonthly)}/month.
      </p>
      <h2>Assumptions and unresolved items</h2>
      <ul>
        {[
          ...new Set([
            ...arc.missing,
            ...arc.coverageGaps,
            ...arc.warnings,
            ...annual.missing,
            ...mig.mi.missing,
            ...mig.partialPools,
          ]),
        ].map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
      <p>
        Annual quotes, licenses, taxes, timing, suitability, storage limits, passive rights and
        regional availability must be confirmed. Zero extra costs mean omitted by assumption. USD
        retail prices are not binding quotes. Reservations are charged upfront in the scenario;
        monthly run rates amortize compute. Expired coverage is not a free protection option.
      </p>
      <p>{s.prices.notes}</p>
      <h2>Primary Microsoft sources</h2>
      {sources.map(([n, u]) => (
        <p key={u} className="report-source">
          <strong>{n}:</strong> {u}
        </p>
      ))}
    </article>
  );
}
