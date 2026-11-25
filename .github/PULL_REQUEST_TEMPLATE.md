## Summary

<!-- What changes and why. Link the issue or design note if there is one. -->

## Change type

- [ ] Bug fix
- [ ] New capability or component
- [ ] Change to existing behavior or defaults
- [ ] Refactor or cleanup (no behavior change)
- [ ] Documentation or diagrams only
- [ ] CI, tooling or validation

## Planes changed

- [ ] Template: `main.bicep`, `azuredeploy.json`, `createUiDefinition.json`, parameter files
- [ ] Provisioner: `scripts/onegrid-solution-provision.ps1`, `infra/deploy.ps1`, deployment scripts
- [ ] App: `OGE-OneGrid/` (report-app, webapp, chat agent) or the release package
- [ ] Fabric content: `infra/fabric/` (lakehouse, eventhouse/KQL, semantic models, notebooks, data agent)
- [ ] Docs: `docs/`, `README.md`, `DEPLOY-WITH-COPILOT.md`
- [ ] Diagrams: `docs/diagrams/`

## Checklist

Tick what applies; strike through or explain anything that doesn't.

**Template**

- [ ] Rebuilt `azuredeploy.json` from `main.bicep` (`az bicep build --file planetary-computer-pro-poc/deploy/azure/main.bicep --outfile planetary-computer-pro-poc/deploy/azure/azuredeploy.json`), also after editing `scripts/onegrid-solution-provision.ps1`, which the template embeds
- [ ] Updated the portal form (`createUiDefinition.json`) for added, renamed or removed parameters, and `python planetary-computer-pro-poc/deploy/azure/tools/check_ui_definition.py` reports no errors
- [ ] Updated parameter files and the generated deployment reference (`python docs/deploy/build_reference.py`)
- [ ] Attached `az deployment group what-if` output for the changed template (run the **Validate infrastructure** workflow manually with a parameter file, or paste local output below)

**Deployment-affecting changes** (template, provisioner, app package, Fabric content)

- [ ] Ran `Test-OneGridPrerequisites.ps1` for the target subscription and region
- [ ] Deployed to a test resource group and attached the `Test-OneGridDeployment.ps1` summary and JSON evidence (redact tenant-specific values before sharing)
- [ ] Recorded components that were disabled as N/A and the MANUAL acceptance rows that were checked by hand

**Docs and diagrams**

- [ ] Rebuilt diagrams with `python docs/diagrams/build_diagrams.py --png` and committed the SVG, PNG, gallery and draw.io outputs
- [ ] Updated the docs that describe the changed behavior (deployment guide, implementation reference, runbook, Copilot runbook)

**CI**

- [ ] **Validate infrastructure** passes (blocking jobs: bicep, ui-definition, powershell, docs); new ARM-TTK or PSRule findings are reviewed

## Evidence

<!--
Paste or attach:
- what-if output for template changes
- Test-OneGridDeployment.ps1 summary table (and the onegrid-acceptance-*.json file)
- screenshots for UI changes
Do not paste secrets, tokens, connection strings or full deployment-script logs.
-->

## Rollback

<!-- How to undo this change in a deployed environment (redeploy previous ref, revert app package, restore data, ...). -->
