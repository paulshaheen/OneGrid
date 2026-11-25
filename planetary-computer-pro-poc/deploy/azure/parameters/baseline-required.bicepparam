// OneGrid baseline, required values only (greenfield).
// Reproduces the portal form's default component selection: GeoCatalog, sample storage,
// the Microsoft Foundry model, the Fabric plane, the web app, and the historical data seed.
// Creates a new F2 Fabric capacity instead of asking for an existing one.
// Twin of baseline-required.parameters.json; keep the two in sync.
using '../main.bicep'

param location = 'westeurope'

param deployGeoCatalog = true
param deploySampleStorage = true
param deployAiAgent = true
param deployAuroraModel = false
param deployAuroraSchedule = false
param deployFabricPlane = true
param deployOneGridApp = true
param deployOneGridData = true

// A new F-SKU capacity bills hourly until you pause or delete it.
param createFabricCapacity = true
param createFabricConnection = true
