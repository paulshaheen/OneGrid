# Vendored ESU Compass core — DO NOT EDIT

`esu-compass/` is a byte-for-byte copy of the supplied ESU Compass release and is
the financial source of truth for Extended Security Updates planning. It is treated
as a frozen, versioned dependency.

**Rules**

- Do **not** modify anything under `esu-compass/` (`lib/`, `tests/`, `integration/`,
  `scripts/`). Line endings are LF; hashes are fixed.
- The OneGrid feature imports the engine only through
  `webapp/src/features/esu/esu-core.ts`.
- Verify integrity + calculations after any dependency bump:

  ```
  node webapp/src/features/esu/vendor/esu-compass/scripts/verify-esu-integrity.mjs
  node webapp/src/features/esu/vendor/esu-compass/tests/run.mjs
  ```

  Expect `All 7 protected files match…` and `34 calculation and import checks passed.`

- To update the engine, replace the whole `esu-compass/` tree with a new verified
  release (including a refreshed `integration/CORE_INTEGRITY.json`). Never hand-edit
  files or regenerate hashes.

Baseline commit: `9d4cf8caf2138ccd2c04a1b4652b7a6bef1d2520`.
