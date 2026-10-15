/**
 * ESU Compass core adapter — the ONLY module the OneGrid ESU feature imports from.
 *
 * Everything re-exported here comes byte-for-byte from the vendored ESU Compass
 * release under ./vendor/esu-compass/. That engine is a versioned dependency and
 * the financial source of truth:
 *
 *   • NEVER edit any file under ./vendor/esu-compass/** (lib, tests, integration).
 *   • Verify the copy with:
 *       node src/features/esu/vendor/esu-compass/scripts/verify-esu-integrity.mjs
 *       node src/features/esu/vendor/esu-compass/tests/run.mjs
 *   • The UI adapts presentation only; all pricing/eligibility math stays in the engine.
 *
 * Baseline commit: 9d4cf8caf2138ccd2c04a1b4652b7a6bef1d2520 (7 protected files, 34 checks).
 */
import { estimate, miCost, migration, type Estimate } from "./vendor/esu-compass/lib/engine";
import type { State } from "./vendor/esu-compass/lib/model";

// ── Engine: pricing / eligibility / lifecycle math (black box) ───────────────
export {
  estimate,
  miCost,
  migration,
  money,
  programFor,
  statusFor,
  makeLines,
  billableWindows,
  billableSql,
  DAY,
  stamp,
  iso,
  addDays,
  addMonths,
  hours,
} from "./vendor/esu-compass/lib/engine";
export type { Line, Charge, Estimate } from "./vendor/esu-compass/lib/engine";

// ── Model: types, lifecycle programs, reference sources, constructors ────────
export {
  programs,
  sources,
  newCoverage,
  newHost,
  newWorkload,
  newSql,
  uid,
} from "./vendor/esu-compass/lib/model";
export type {
  Family,
  Entitlement,
  Coverage,
  Sql,
  Workload,
  Host,
  Meter,
  PriceBook,
  MI,
  State,
  Program,
} from "./vendor/esu-compass/lib/model";

// ── Defaults: initial scenario (sample estate vs empty real customer) ────────
export { initialState } from "./vendor/esu-compass/lib/defaults";

// ── Import / export: zod schema, validation, CSV inventory round-trip ────────
export {
  stateSchema,
  validateState,
  parseCSV,
  importInventory,
  csvTemplate,
  csvEscape,
  download,
} from "./vendor/esu-compass/lib/import-export";

// ── Rates: Azure Retail price-book parser (shared with /api/prices) ──────────
export { parseRates } from "./vendor/esu-compass/lib/rates";
export type { RetailItem } from "./vendor/esu-compass/lib/rates";

/**
 * Full-scenario convenience that composes the engine's public functions without
 * altering any math — returns the complete Arc vs annual comparison plus the
 * Managed Instance cost and migration analysis for a single validated State.
 */
export type ScenarioResult = {
  arc: Estimate;
  annual: Estimate;
  mi: ReturnType<typeof miCost>;
  migration: ReturnType<typeof migration>;
};

export function computeScenario(state: State): ScenarioResult {
  return {
    arc: estimate(state, "arc"),
    annual: estimate(state, "annual"),
    mi: miCost(state),
    migration: migration(state),
  };
}
