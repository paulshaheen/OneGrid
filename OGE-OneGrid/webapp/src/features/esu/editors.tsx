import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field, NumberInput, Toggle, Notice, Modal } from "./ui";
import { newSql, type Host, type Workload, type Coverage, type Entitlement } from "./esu-core";
const entitlements = [
  ["sa", "Perpetual + active SA"],
  ["subscription", "Qualifying subscription"],
  ["payg", "Azure PAYG software license"],
  ["spla", "SPLA (Windows)"],
  ["servercal", "Server + CAL (SQL)"],
  ["none", "No SA / unconfirmed"],
];
function EntitlementSelect({
  value,
  onChange,
}: {
  value: Entitlement;
  onChange: (x: Entitlement) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Entitlement)}>
      {entitlements.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
function CoverageFields({ value, onChange }: { value: Coverage; onChange: (x: Coverage) => void }) {
  return (
    <div className="form-grid">
      <Field label="Existing ESU coverage">
        <select
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as Coverage["mode"] })}
        >
          <option value="new">New enrollment / no coverage</option>
          <option value="arc">Existing Arc coverage</option>
          <option value="annual">Annual volume license</option>
        </select>
      </Field>
      <Field label="Fully paid ESU years" hint="Count completed program years, not calendar years.">
        <select
          value={value.priorYears}
          onChange={(e) => onChange({ ...value, priorYears: Number(e.target.value) })}
        >
          {[0, 1, 2, 3].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </Field>
      {value.mode === "arc" && (
        <Field
          label="Arc coverage paid through"
          hint="Inclusive date; gaps after this date can be back-billed."
        >
          <input
            type="date"
            value={value.paidThrough}
            onChange={(e) => onChange({ ...value, paidThrough: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}
export function HostEditor({
  host,
  onSave,
  onClose,
}: {
  host: Host;
  onSave: (h: Host) => void;
  onClose: () => void;
}) {
  const [h, set] = useState(structuredClone(host));
  const update = (x: Partial<Host>) => set({ ...h, ...x });
  return (
    <Modal
      title="Physical host configuration"
      subtitle="Describe one host, or a group of identical hosts."
      onClose={onClose}
      onSave={() => {
        if (h.name.trim()) onSave(h);
      }}
    >
      <div className="form-grid">
        <Field label="Host or group name">
          <input value={h.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Identical hosts">
          <NumberInput
            value={h.quantity}
            min={1}
            step="1"
            onChange={(n) => update({ quantity: n || 1 })}
          />
        </Field>
        <Field label="Processors per host">
          <NumberInput
            value={h.sockets}
            min={1}
            step="1"
            onChange={(n) => update({ sockets: n || 1 })}
          />
        </Field>
        <Field label="Physical cores per processor">
          <NumberInput
            value={h.coresPerSocket}
            min={1}
            step="1"
            onChange={(n) => update({ coresPerSocket: n || 1 })}
          />
        </Field>
        <Field label="Location">
          <select
            value={h.location}
            onChange={(e) => update({ location: e.target.value as Host["location"] })}
          >
            <option value="onprem">On premises</option>
            <option value="azure">Azure VMs / AVS</option>
            <option value="azurelocal">Azure Local</option>
            <option value="other">Other cloud / hosted</option>
          </select>
        </Field>
      </div>
      <h3>License the right footprint</h3>
      <div className="form-grid">
        <Field label="Windows Server ESU basis">
          <select
            value={h.windowsMode}
            onChange={(e) => update({ windowsMode: e.target.value as Host["windowsMode"] })}
          >
            <option value="vm">Each VM · 8-core minimum</option>
            <option value="standard">Physical Standard · 2 OSEs per pass</option>
            <option value="datacenter">Physical Datacenter · unlimited VMs</option>
          </select>
        </Field>
        <Field label="SQL Server ESU basis">
          <select
            value={h.sqlMode}
            onChange={(e) => update({ sqlMode: e.target.value as Host["sqlMode"] })}
          >
            <option value="vm">Each OSE · 4-core minimum</option>
            <option value="enterprise">Physical Enterprise · unlimited VMs</option>
          </select>
        </Field>
      </div>
      <Toggle checked={h.rightsConfirmed} onChange={(v) => update({ rightsConfirmed: v })}>
        Underlying virtualization rights and physical licensing scope confirmed
      </Toggle>
      {h.location === "azurelocal" && (
        <Toggle checked={h.azureVerified} onChange={(v) => update({ azureVerified: v })}>
          Azure verification is active for these VMs
        </Toggle>
      )}
      <Notice>
        VM quantities are per host. A group of 3 hosts with 4 VMs each represents 12 VMs. For
        clusters with VM mobility, include every host requiring coverage.
      </Notice>
      {h.windowsMode === "standard" && (
        <Notice tone="warn">
          Standard physical coverage repeats all host cores for each two OSEs. Microsoft’s Arc
          example contains inconsistent quantities; confirm the resulting license count with your
          licensing team.
        </Notice>
      )}
    </Modal>
  );
}
export function WorkloadEditor({
  workload,
  hosts,
  onSave,
  onClose,
}: {
  workload: Workload;
  hosts: Host[];
  onSave: (w: Workload) => void;
  onClose: () => void;
}) {
  const [w, set] = useState(structuredClone(workload));
  const update = (x: Partial<Workload>) => set({ ...w, ...x });
  return (
    <Modal
      title="Workload configuration"
      subtitle="One row represents an operating-system environment, or identical copies."
      onClose={onClose}
      onSave={() => {
        if (w.name.trim() && w.hostId) onSave(w);
      }}
    >
      <div className="form-grid">
        <Field label="Workload name">
          <input value={w.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Parent host">
          <select value={w.hostId} onChange={(e) => update({ hostId: e.target.value })}>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deployment">
          <select
            value={w.kind}
            onChange={(e) =>
              update({
                kind: e.target.value as Workload["kind"],
                quantity: e.target.value === "physical" ? 1 : w.quantity,
              })
            }
          >
            <option value="vm">Virtual machine</option>
            <option value="physical">Bare metal / productive host OSE</option>
          </select>
        </Field>
        <Field label={w.kind === "vm" ? "VM copies per host" : "Physical OSEs per host"}>
          <NumberInput
            value={w.quantity}
            min={1}
            step="1"
            onChange={(n) => update({ quantity: w.kind === "physical" ? 1 : n || 1 })}
          />
        </Field>
        {w.kind === "vm" && (
          <Field label="Assigned vCores per VM">
            <NumberInput
              value={w.cores}
              min={1}
              step="1"
              onChange={(n) => update({ cores: n || 1 })}
            />
          </Field>
        )}
      </div>
      <h3>Windows Server</h3>
      <div className="form-grid">
        <Field label="OS version">
          <select value={w.osVersion} onChange={(e) => update({ osVersion: e.target.value })}>
            {["none", "2008 R2", "2012", "2012 R2", "2016", "2019", "2022", "2025"].map((v) => (
              <option key={v} value={v}>
                {v === "none" ? "No Windows Server / Linux" : `Windows Server ${v}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Underlying OS edition">
          <select
            value={w.osEdition}
            onChange={(e) => update({ osEdition: e.target.value as Workload["osEdition"] })}
          >
            <option>Standard</option>
            <option>Datacenter</option>
          </select>
        </Field>
        <Field label="OS license entitlement">
          <EntitlementSelect
            value={w.osEntitlement}
            onChange={(v) => update({ osEntitlement: v })}
          />
        </Field>
      </div>
      {w.osVersion !== "none" && (
        <CoverageFields value={w.coverage} onChange={(v) => update({ coverage: v })} />
      )}
      <div className="section-title">
        <h3>SQL Server installations</h3>
        <button
          className="button small secondary"
          onClick={() => update({ sql: [...w.sql, newSql()] })}
        >
          <Plus size={14} />
          Add SQL version
        </button>
      </div>
      <p className="muted small">
        Add one entry per SQL version. Same-version instances share an OSE charge at the highest
        installed edition. Separate versions have separate ESU charges.
      </p>
      {w.sql.map((sq, i) => (
        <div className="subform" key={sq.id}>
          <div className="section-title">
            <h4>SQL installation {i + 1}</h4>
            <button
              className="icon-button danger"
              aria-label="Remove SQL installation"
              onClick={() => update({ sql: w.sql.filter((_, j) => i !== j) })}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="form-grid">
            <Field label="SQL version">
              <select
                value={sq.version}
                onChange={(e) =>
                  update({
                    sql: w.sql.map((x, j) => (j === i ? { ...x, version: e.target.value } : x)),
                  })
                }
              >
                {["2012", "2014", "2016", "2017", "2019", "2022", "2025"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Highest installed edition">
              <select
                value={sq.edition}
                onChange={(e) =>
                  update({
                    sql: w.sql.map((x, j) =>
                      j === i ? { ...x, edition: e.target.value as typeof sq.edition } : x,
                    ),
                  })
                }
              >
                {["Standard", "Enterprise", "Developer", "Express", "Web"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="SQL license entitlement">
              <EntitlementSelect
                value={sq.entitlement}
                onChange={(v) =>
                  update({ sql: w.sql.map((x, j) => (j === i ? { ...x, entitlement: v } : x)) })
                }
              />
            </Field>
          </div>
          <CoverageFields
            value={sq.coverage}
            onChange={(v) =>
              update({ sql: w.sql.map((x, j) => (j === i ? { ...x, coverage: v } : x)) })
            }
          />
          <Toggle
            checked={sq.exempt}
            onChange={(v) =>
              update({ sql: w.sql.map((x, j) => (j === i ? { ...x, exempt: v } : x)) })
            }
          >
            Verified free passive replica or eligible Azure dev/test OSE
          </Toggle>
          {sq.exempt && (
            <p className="small amber-text">
              Attestation required: all instances/services on the OSE must qualify. A secondary
              label alone does not confer an exemption.
            </p>
          )}
        </div>
      ))}
      {w.sql.length > 0 && (
        <>
          <h3>Migration selection</h3>
          <Toggle checked={w.migrate} onChange={(v) => update({ migrate: v })}>
            Include this workload in the Managed Instance scenario
          </Toggle>
          <Toggle checked={w.retireOS} onChange={(v) => update({ retireOS: v })}>
            The Windows OS can also be decommissioned after SQL migration
          </Toggle>
          <p className="muted small">
            Keep this off if application services, SSIS, SSRS, or other dependencies remain on this
            OS.
          </p>
        </>
      )}
    </Modal>
  );
}
