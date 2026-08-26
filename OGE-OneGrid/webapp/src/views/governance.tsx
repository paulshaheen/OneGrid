import { Database, GitBranch, Lock, ShieldCheck, Users } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";

// P1: Governance & Security, ported from the report-app "Governance" persona and
// restyled to the OneGrid tokens. Sample content until wired to OneLake in P2.
const ACCESS = [
  {
    principal: "Storm Response Team",
    role: "Reader",
    scope: "GoM workspace",
    posture: "Least privilege",
  },
  {
    principal: "Reservoir Engineering",
    role: "Contributor",
    scope: "Asset registry",
    posture: "Reviewed",
  },
  {
    principal: "Platform Ops",
    role: "Reader",
    scope: "Eventhouse (KQL)",
    posture: "Least privilege",
  },
  {
    principal: "Data Platform",
    role: "Admin",
    scope: "Capacity / Fabric",
    posture: "Break-glass only",
  },
];

const LABELS = [
  { dataset: "Asset register", label: "Confidential", masking: "Operator column masked" },
  { dataset: "Well telemetry", label: "Confidential", masking: "Row-level by region" },
  { dataset: "Forecast cycles", label: "General", masking: "None" },
];

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <Icon className="size-4 text-primary" /> {title}
      </div>
      <div className="text-[13px] text-muted-foreground">{children}</div>
    </div>
  );
}

export function GovernancePage() {
  return (
    <AppShell>
      <PageHeader
        title="Governance & Security"
        description="OneLake security and lineage review plane — access, sensitivity and provenance for the OneGrid estate."
      />
      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card icon={Lock} title="OneLake access">
            12 workspaces · 4 roles · least-privilege verified this cycle. 1 break-glass admin.
          </Card>
          <Card icon={GitBranch} title="Lineage">
            Every KPI traces to a semantic-model measure or a KQL query — no unsourced numbers.
          </Card>
          <Card icon={ShieldCheck} title="Sensitivity">
            2 datasets labeled <span className="text-foreground">Confidential</span>; masking &amp;
            row-level security enforced.
          </Card>
        </div>

        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3 text-[13px] font-semibold">
            <Users className="size-4 text-primary" /> Access review
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Principal</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Scope</th>
                <th className="px-4 py-2 font-medium">Posture</th>
              </tr>
            </thead>
            <tbody>
              {ACCESS.map((a) => (
                <tr key={a.principal} className="border-t">
                  <td className="px-4 py-2.5 font-medium">{a.principal}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.role}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.scope}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.posture}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3 text-[13px] font-semibold">
            <Database className="size-4 text-primary" /> Sensitivity labels
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Dataset</th>
                <th className="px-4 py-2 font-medium">Label</th>
                <th className="px-4 py-2 font-medium">Masking</th>
              </tr>
            </thead>
            <tbody>
              {LABELS.map((l) => (
                <tr key={l.dataset} className="border-t">
                  <td className="px-4 py-2.5 font-medium">{l.dataset}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        l.label === "Confidential"
                          ? "rounded-full bg-risk-high/20 px-2 py-0.5 text-[11px] font-semibold text-risk-high"
                          : "rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                      }
                    >
                      {l.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{l.masking}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
