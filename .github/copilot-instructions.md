# Copilot instructions for the OneGrid repository

- When asked to deploy OneGrid (to Azure, to a subscription, "stand it up", "install it"),
  follow [DEPLOY-WITH-COPILOT.md](../DEPLOY-WITH-COPILOT.md) step by step. Don't improvise a
  different deployment path.
- The customer deployment template is
  `planetary-computer-pro-poc/deploy/azure/main.bicep`, compiled to `azuredeploy.json` with
  `az bicep build --file main.bicep --outfile azuredeploy.json`. Keep the two in sync, and keep
  `createUiDefinition.json` outputs aligned with the template parameters.
- The web app package that deployments install is built by
  `.github/workflows/release-onegrid-app.yml` from `main` and published as the `app-latest`
  release.
- App modules are controlled by the `ONEGRID_MODULES` app setting
  (`OGE-OneGrid/webapp/src/lib/modules.ts`); unset means every module is on.
