// Oil & Gas (OneRig) equipment-manual library for Foundry IQ "Resolve with manual".
// OneRig always renders the deterministic sample estate, so its manuals are served client-side
// from this module (lazy-loaded only for solution=og) with the same offline keyword grounding
// the report-app server uses when Azure AI Search is not configured. Manufacturers and models are
// fictional; the content mimics the structure of an O&M manual without proprietary OEM material.

// ---------------------------------------------------------------------------------------------
// Category definitions: specs per model variant, operating limits, faults (aligned with the
// O&G work-order problems in sample.js), preventive maintenance and safety notes.
// ---------------------------------------------------------------------------------------------
const CATEGORIES = [
  {
    key: "WHD",
    name: "Wellhead & Christmas Tree",
    service:
      "surface (dry-tree) wellhead and Christmas tree assemblies on fixed and tension-leg platforms",
    specFields: [
      "Rated working pressure",
      "Temperature class",
      "Material class / PSL",
      "Production choke",
      "Safety valve",
    ],
    variants: [
      {
        mfr: "Calcasieu Valve & Wellhead",
        model: "WH-10K-S",
        specs: [
          "690 bar (10,000 psi)",
          "P–U (-29 to 121 °C)",
          "EE-NL / PSL 3G",
          "Adjustable needle-and-seat, 2 in",
          "Wireline-retrievable SCSSV",
        ],
        plants: ["West Delta"],
      },
      {
        mfr: "Calcasieu Valve & Wellhead",
        model: "WH-15K-T",
        specs: [
          "1,034 bar (15,000 psi)",
          "L–X (-46 to 180 °C)",
          "FF-NL / PSL 3G",
          "Cage-and-sleeve, 3 in",
          "Tubing-retrievable SCSSV",
        ],
        plants: ["Mars-Ursa"],
      },
      {
        mfr: "Gulfstar Subsea Systems",
        model: "GX-5000",
        specs: [
          "345 bar (5,000 psi)",
          "P–U (-29 to 121 °C)",
          "DD-NL / PSL 2",
          "Positive choke, 1.5 in",
          "Surface safety valve only",
        ],
        plants: ["West Delta", "Mars-Ursa"],
      },
    ],
    limits: [
      "Wellhead flowing pressure (WHP) must stay below 90% of rated working pressure; shut in at the high-high setpoint.",
      "Keep the choke between 10% and 85% open in normal production; operating at the extremes accelerates trim erosion.",
      "Wellhead temperature must remain above the hydrate-formation curve for the current WHP (typically > 20 °C at 100 bar).",
      "Annulus pressures (A/B) must stay below the maximum allowable wellhead operating pressure (MAWOP) for each annulus.",
    ],
    faults: [
      {
        title: "Wellhead pressure excursion / choke instability",
        causes: [
          "Choke trim erosion or wash-out from produced sand",
          "Hydrate formation in the choke body",
          "Downstream separator back-pressure change",
        ],
        steps: [
          "Compare WHP with flowline pressure and the choke position trend to locate the restriction.",
          "If WHP is approaching the high-high setpoint, reduce the choke in 5% steps or shut in per the well control procedure.",
          "Inspect the choke for erosion: check sand-detector readings and the choke Cv against the last calibration.",
          "If wellhead temperature is below the hydrate curve, start MEG or methanol injection upstream of the choke.",
          "Replace worn trim and record the event in the well integrity log.",
        ],
        tags: ["WHP.PRESS", "CHOKE.POS", "WHT.TEMP"],
      },
      {
        title: "Xmas-tree SCSSV function test overdue or failed closure",
        causes: [
          "Missed test interval in the maintenance plan",
          "Control-line hydraulic leak",
          "Flapper or seat damage from debris",
        ],
        steps: [
          "Schedule the subsurface safety valve function and inflow test per the regulatory interval (typically 6 months).",
          "Bleed control-line pressure and record closure time; compare with the acceptance limit.",
          "Perform an inflow (leak) test across the closed valve; leak rate must be within the API 14B allowance.",
          "If the test fails, keep the well shut in, notify the well integrity engineer and plan a wireline intervention.",
        ],
        tags: ["SCSSV control pressure", "WHP.PRESS"],
      },
      {
        title: "Annulus pressure buildup (sustained casing pressure)",
        causes: [
          "Tubing or packer leak",
          "Thermal expansion of trapped annulus fluid",
          "Casing or cement integrity loss",
        ],
        steps: [
          "Record A- and B-annulus pressures and compare with MAWOP.",
          "Perform a bleed-down / build-up diagnostic test: bleed to zero, then trend the rebuild over 24 hours.",
          "Rapid rebuild indicates a communication path; classify per API RP 90 and escalate to well integrity.",
          "Do not bleed repeatedly without approval; sample bled fluid to identify its source (gas, oil, completion fluid).",
        ],
        tags: ["Annulus A pressure", "Annulus B pressure"],
      },
      {
        title: "Low wellhead temperature / hydrate risk",
        causes: [
          "Reduced flow rate after choke-back",
          "Water cut increase",
          "Chemical injection pump trip",
        ],
        steps: [
          "Plot WHP and WHT against the hydrate curve for the current water cut.",
          "Confirm the MEG/methanol injection pump is running and delivering the target rate.",
          "Increase flow or open the choke within limits to raise temperature.",
        ],
        tags: ["WHT.TEMP", "WHP.PRESS"],
      },
      {
        title: "Christmas-tree valve leak-by (master or wing valve)",
        causes: [
          "Gate or seat damage",
          "Insufficient stem packing compression",
          "Debris on the gate",
        ],
        steps: [
          "Perform a two-barrier leak test across the master and wing valves and record pressure build-up.",
          "Service the valve: inject sealant into the seat, cycle, and retest.",
          "Replace the gate and seats at the next planned intervention if leak-by persists.",
        ],
        tags: ["WHP.PRESS"],
      },
    ],
    pm: [
      "Weekly: record WHP, WHT and annulus pressures; check chemical injection rates.",
      "Monthly: grease and cycle tree valves; inspect choke for erosion indicators.",
      "6-monthly: SCSSV and SSV function and inflow tests.",
      "Annually: full tree pressure test and choke trim inspection.",
    ],
    safety: [
      "Treat every wellhead as live; isolate and verify zero energy with two barriers before breaking containment.",
      "H₂S may be present: carry personal gas monitors and follow the sour-service work permit.",
    ],
  },
  {
    key: "GTC",
    name: "Gas Turbine & Compressor",
    service:
      "aeroderivative and industrial gas turbines driving centrifugal compressors and generators offshore and in LNG service",
    specFields: [
      "Rated output",
      "Speed (power turbine)",
      "Driven equipment",
      "Compressor type",
      "Seal system",
    ],
    variants: [
      {
        mfr: "Corsair Turbomachinery",
        model: "CT-25 DLE",
        specs: [
          "25 MW ISO",
          "6,100 rpm",
          "Gas compressor / generator",
          "Centrifugal, 2-stage",
          "Tandem dry gas seals",
        ],
        plants: ["West Delta", "Mars-Ursa"],
      },
      {
        mfr: "Corsair Turbomachinery",
        model: "CT-40 MR",
        specs: [
          "40 MW ISO",
          "3,600 rpm",
          "Mixed-refrigerant compressor",
          "Centrifugal, 3-section",
          "Tandem dry gas seals with intermediate labyrinth",
        ],
        plants: ["Sabine Pass"],
      },
      {
        mfr: "Bayou Rotating Equipment",
        model: "BRE-12 Mk II",
        specs: [
          "12 MW ISO",
          "9,500 rpm",
          "Gas re-injection compressor",
          "Centrifugal, barrel",
          "Single dry gas seal",
        ],
        plants: ["Mars-Ursa", "West Delta"],
      },
    ],
    limits: [
      "Overall vibration: alarm at 7.1 mm/s, trip at 11 mm/s (ISO 10816-4 zone boundaries).",
      "Bearing temperature: alarm at 105 °C, trip at 115 °C.",
      "Exhaust-gas temperature (EGT) spread across thermocouples must stay below 30 °C; trip above 60 °C.",
      "Compressor operating point must remain at least 10% from the surge line; the anti-surge valve opens at 10% margin.",
      "Seal-gas differential pressure must remain above 0.5 bar across the primary seal.",
    ],
    faults: [
      {
        title: "Gas turbine vibration alarm — investigate bearing",
        causes: [
          "Bearing wear or babbitt damage",
          "Rotor unbalance from blade fouling or damage",
          "Misalignment after maintenance",
          "Lube-oil supply temperature or pressure deviation",
        ],
        steps: [
          "Check the vibration spectrum: 1× running speed suggests unbalance, 2× misalignment, sub-synchronous oil whirl.",
          "Compare bearing temperatures and lube-oil supply pressure/temperature with normal values.",
          "If vibration is rising toward trip, reduce load and plan a controlled shutdown rather than waiting for a trip.",
          "Perform a borescope inspection for blade damage and an offline water wash if fouling is suspected.",
          "After repair, record new vibration baselines.",
        ],
        tags: ["GT.VIBR", "GT.BRG_TEMP", "GT.RPM"],
      },
      {
        title: "Compressor surge margin low — check anti-surge valve",
        causes: [
          "Anti-surge valve sticking or slow stroke",
          "Suction flow transmitter drift",
          "Process upset reducing flow (well shut-in, train trip)",
        ],
        steps: [
          "Stroke-test the anti-surge valve: full stroke must complete within 2 seconds.",
          "Cross-check the suction flow transmitter against the discharge flow and the performance map.",
          "Verify the surge controller set points and surge-line parameters against the latest performance test.",
          "If recycle is insufficient, reduce speed and increase recycle until the operating point is outside the control margin.",
        ],
        tags: ["Suction flow", "Anti-surge valve position", "GT.RPM"],
      },
      {
        title: "Exhaust-gas temperature spread high",
        causes: [
          "Fuel nozzle coking or blockage",
          "Combustor liner damage",
          "Failed or drifting exhaust thermocouple",
        ],
        steps: [
          "Identify the cold or hot thermocouple and map it back to the upstream combustor using the swirl angle.",
          "Check the suspect thermocouple's resistance and compare with its neighbours.",
          "Inspect fuel nozzles and the combustor with a borescope at the next opportunity.",
          "If the spread exceeds the trip limit, unload and shut down.",
        ],
        tags: ["GT.EXH_TEMP"],
      },
      {
        title: "Refrigerant or process compressor seal-gas alarm",
        causes: [
          "Seal-gas filter differential pressure high",
          "Primary seal leakage increase",
          "Separation (buffer) gas supply loss",
        ],
        steps: [
          "Check the seal-gas filter differential pressure and change over to the standby filter.",
          "Trend primary vent flow; a step increase indicates primary seal damage.",
          "Verify separation-gas (nitrogen) supply pressure to protect the seals from lube oil.",
          "Plan a seal replacement if primary vent flow exceeds the manufacturer limit.",
        ],
        tags: ["Seal gas dP", "Primary vent flow"],
      },
      {
        title: "Lube-oil pressure or temperature deviation",
        causes: ["Lube-oil filter clogging", "Cooler fouling", "Auxiliary pump not starting"],
        steps: [
          "Check the filter differential pressure and change over filters.",
          "Verify the cooler outlet temperature and cooling-water flow.",
          "Test auto-start of the auxiliary lube-oil pump.",
        ],
        tags: ["Lube oil pressure", "GT.BRG_TEMP"],
      },
    ],
    pm: [
      "Daily: review vibration, EGT spread, seal-gas and lube-oil trends.",
      "Monthly: online compressor wash; anti-surge valve partial stroke test.",
      "Quarterly: borescope inspection; lube-oil analysis.",
      "Every 25,000 h: hot-section inspection; every 50,000 h: major overhaul.",
    ],
    safety: [
      "Enclosure gas detection and fire suppression must be healthy before entry; follow the enclosure entry permit.",
      "Depressurize and purge the compressor case before opening; confirm zero energy on the starter.",
    ],
  },
  {
    key: "PMP",
    name: "Centrifugal Pump",
    service: "export, injection, charge, transfer and booster pumps in crude and water service",
    specFields: ["Rated flow", "Rated head", "Driver", "API 610 type", "Seal plan"],
    variants: [
      {
        mfr: "Bayou Rotating Equipment",
        model: "BB3-Export 8x10",
        specs: [
          "1,250 m³/h",
          "620 m",
          "6.5 MW electric motor",
          "BB3 axially split multistage",
          "API Plan 53B dual seal",
        ],
        plants: ["West Delta", "Louisiana Offshore"],
      },
      {
        mfr: "Tidewater Process Equipment",
        model: "TPE-OH2 6x8",
        specs: [
          "420 m³/h",
          "140 m",
          "450 kW electric motor",
          "OH2 overhung",
          "API Plan 11 single seal",
        ],
        plants: ["Port Arthur", "Clovelly Hub"],
      },
      {
        mfr: "Bayou Rotating Equipment",
        model: "BB5-Injection 4x6",
        specs: [
          "300 m³/h",
          "2,200 m",
          "4.5 MW VFD motor",
          "BB5 barrel multistage",
          "API Plan 53B dual seal",
        ],
        plants: ["Mars-Ursa"],
      },
    ],
    limits: [
      "Operate between 70% and 110% of best-efficiency-point flow; never below the minimum continuous stable flow.",
      "Bearing temperature: alarm at 85 °C, trip at 95 °C.",
      "Vibration: alarm at 4.5 mm/s, trip at 7.1 mm/s.",
      "Available NPSH must exceed required NPSH by at least 1 m (or 30%).",
    ],
    faults: [
      {
        title: "Export pump mechanical seal leak",
        causes: [
          "Seal face wear or thermal distortion",
          "Loss of seal flush or barrier pressure",
          "Dry running during start-up",
        ],
        steps: [
          "Check the seal-pot level and barrier pressure (Plan 53B) or the flush flow (Plan 11).",
          "Quantify leakage at the drain; above the manufacturer limit, switch to the standby pump.",
          "Inspect seal faces for heat checking or chipping and replace the cartridge seal.",
          "Verify the shaft run-out and the seal setting before restart.",
        ],
        tags: ["Seal pot level", "Barrier pressure", "PMP.VIBR"],
      },
      {
        title: "Injection pump bearing temperature trending high",
        causes: [
          "Lubricant degradation or wrong level",
          "Coupling misalignment",
          "Excessive axial thrust from balance-line blockage",
        ],
        steps: [
          "Check the oil level, sight-glass colour and constant-level oiler.",
          "Take an oil sample; replace the oil if water or particles are present.",
          "Check alignment with laser tools; correct to within 0.05 mm offset.",
          "On multistage pumps, check balance-line pressure for blockage.",
        ],
        tags: ["PMP.BRG_TEMP", "PMP.VIBR"],
      },
      {
        title: "Discharge pressure low — check recirculation valve",
        causes: [
          "Minimum-flow (recirculation) valve stuck open",
          "Impeller or wear-ring wear",
          "Suction strainer blockage",
        ],
        steps: [
          "Confirm the recirculation valve position and stroke it; a passing valve lowers delivered head.",
          "Compare the operating point with the pump curve; a drop across the whole curve points to internal wear.",
          "Check suction strainer differential pressure and clean if above the limit.",
          "Plan an impeller and wear-ring replacement if wear exceeds twice the design clearance.",
        ],
        tags: ["PMP.DISCH_PRESS", "Recirculation valve position"],
      },
      {
        title: "Cavitation noise or erratic flow",
        causes: [
          "Low suction pressure or tank level",
          "High fluid temperature",
          "Suction valve partially closed",
        ],
        steps: [
          "Verify suction pressure and the vessel or tank level.",
          "Confirm the suction valve is fully open and the strainer is clean.",
          "Reduce flow toward best-efficiency point until NPSH margin is restored.",
        ],
        tags: ["Suction pressure", "PMP.VIBR"],
      },
      {
        title: "High vibration after maintenance",
        causes: ["Misalignment", "Soft foot", "Pipe strain"],
        steps: [
          "Check soft foot and correct with shims.",
          "Re-align the coupling and check nozzle loads by unbolting the suction flange.",
          "Run a vibration spectrum to confirm the fix.",
        ],
        tags: ["PMP.VIBR"],
      },
    ],
    pm: [
      "Daily: check seal leakage, oil level and vibration.",
      "Monthly: lube-oil sample; strainer differential pressure check.",
      "Quarterly: alignment check; performance test against the curve.",
      "Every 3–5 years: overhaul including wear rings, bearings and seals.",
    ],
    safety: [
      "Isolate, drain and depressurize before maintenance; hydrocarbon service may contain H₂S.",
      "Lock out the motor at the switchgear and verify zero speed before opening the coupling guard.",
    ],
  },
  {
    key: "TGN",
    name: "Turbo-Generator",
    service: "platform main power generators and their excitation and lube-oil systems",
    specFields: ["Rated output", "Voltage", "Cooling", "Excitation", "Power factor"],
    variants: [
      {
        mfr: "Pelican Electric Machines",
        model: "PEM-30 TEWAC",
        specs: [
          "30 MVA",
          "13.8 kV",
          "Totally enclosed water-to-air cooled",
          "Brushless with digital AVR",
          "0.85 lagging",
        ],
        plants: ["West Delta"],
      },
      {
        mfr: "Pelican Electric Machines",
        model: "PEM-18 OAC",
        specs: ["18 MVA", "11 kV", "Open air-cooled", "Brushless with digital AVR", "0.8 lagging"],
        plants: ["West Delta", "Mars-Ursa"],
      },
    ],
    limits: [
      "Stator winding temperature: alarm at 130 °C, trip at 140 °C (class F insulation, class B rise).",
      "Lube-oil header pressure must stay above 1.2 bar; trip below 0.8 bar.",
      "Do not exceed the capability curve; avoid prolonged under-excited (leading) operation.",
    ],
    faults: [
      {
        title: "Turbo-generator stator temperature high — inspect cooling",
        causes: [
          "Air cooler fouling or cooling-water flow loss",
          "Overload or unbalanced loading",
          "Blocked air filters",
        ],
        steps: [
          "Compare stator RTDs; a single hot RTD suggests a local issue, all RTDs a cooling issue.",
          "Check cooling-water flow and temperature across the air coolers.",
          "Reduce load to bring the temperature below the alarm limit.",
          "Inspect and clean coolers and filters at the next outage.",
        ],
        tags: ["GEN.STATOR_TEMP", "GEN.LOAD"],
      },
      {
        title: "Lube-oil pressure low on generator skid",
        causes: ["Main oil pump wear", "Filter blockage", "Pressure regulating valve fault"],
        steps: [
          "Check the filter differential pressure and change over filters.",
          "Confirm the standby pump auto-starts on low pressure.",
          "Inspect the pressure regulating valve and gauge calibration.",
        ],
        tags: ["Lube oil pressure"],
      },
      {
        title: "AVR excitation fault",
        causes: [
          "Rotating diode failure",
          "AVR power supply or sensing fault",
          "Exciter field winding fault",
        ],
        steps: [
          "Read the AVR event log and fault code.",
          "Check field current and exciter field resistance.",
          "Test rotating diodes during the next shutdown; replace any open or shorted diode.",
        ],
        tags: ["Field current", "GEN.LOAD"],
      },
      {
        title: "Generator synchronizing failure",
        causes: [
          "Synchronizer settings out of tolerance",
          "Voltage or frequency mismatch",
          "Breaker close circuit fault",
        ],
        steps: [
          "Verify synchronizer voltage, frequency and phase windows.",
          "Check the breaker close coil and permissives.",
        ],
        tags: ["Bus frequency", "Bus voltage"],
      },
    ],
    pm: [
      "Daily: review stator temperatures, load and lube-oil pressure.",
      "Annually: insulation resistance and polarization index tests; cooler cleaning.",
      "Every 4 years: rotor inspection and rotating-diode test.",
    ],
    safety: [
      "Apply electrical isolation and earthing per the high-voltage switching program before any work.",
    ],
  },
  {
    key: "FHT",
    name: "Fired Heater",
    service:
      "refinery process heaters (crude charge and reboiler service) with natural-draft or balanced-draft firing",
    specFields: ["Duty", "Configuration", "Passes", "Fuel", "Burners"],
    variants: [
      {
        mfr: "Ridgeline Fired Systems",
        model: "RFS-CH-120",
        specs: [
          "120 MW absorbed",
          "Cabin, natural draft",
          "4",
          "Refinery fuel gas",
          "16 ultra-low-NOx",
        ],
        plants: ["Port Arthur"],
      },
      {
        mfr: "Ridgeline Fired Systems",
        model: "RFS-VC-45",
        specs: [
          "45 MW absorbed",
          "Vertical cylindrical, balanced draft",
          "2",
          "Fuel gas / fuel oil",
          "8 low-NOx",
        ],
        plants: ["Port Arthur"],
      },
    ],
    limits: [
      "Tube skin (coil) temperature must stay below the design limit, typically 650 °C for 9Cr-1Mo tubes.",
      "Arch draft must be negative, -2 to -5 mm H₂O.",
      "Flue-gas O₂ target 2–3%; never operate below 1% (combustibles risk).",
      "Pass flows must be balanced within ±5%; trip on low-low pass flow.",
    ],
    faults: [
      {
        title: "Fired-heater tube skin temperature high",
        causes: [
          "Coke build-up inside tubes",
          "Flame impingement from burner misalignment",
          "Pass flow imbalance",
        ],
        steps: [
          "Compare skin thermocouples across passes and against infrared camera readings.",
          "Check pass flows and rebalance; low flow in a pass raises its skin temperature.",
          "Inspect burners through the peepholes for impingement; adjust air registers.",
          "Plan decoking (steam-air or pigging) when skin temperature trends toward the design limit.",
        ],
        tags: ["HTR.COIL_TEMP", "HTR.PRESS"],
      },
      {
        title: "Burner flame instability — check fuel-gas pressure",
        causes: ["Fuel-gas pressure fluctuation", "Burner tip plugging", "Excessive draft"],
        steps: [
          "Trend fuel-gas header pressure and the control valve output.",
          "Check the knockout drum for liquid carryover.",
          "Clean or replace plugged burner tips.",
          "Adjust the stack damper to restore the target draft.",
        ],
        tags: ["Fuel gas pressure", "HTR.O2"],
      },
      {
        title: "Flue-gas O₂ analyzer drift",
        causes: ["Probe fouling", "Calibration gas fault", "Air in-leakage near the probe"],
        steps: [
          "Run a two-point calibration with certified gases.",
          "Compare with a portable analyzer at the same elevation.",
          "Seal air in-leakage around the probe and peepholes.",
        ],
        tags: ["HTR.O2"],
      },
      {
        title: "Draft high or low",
        causes: [
          "Stack damper malfunction",
          "Weather (wind) effects",
          "Convection section fouling",
        ],
        steps: [
          "Verify the damper position against its signal.",
          "Clean the convection section with soot blowers or offline water wash.",
        ],
        tags: ["Arch draft"],
      },
    ],
    pm: [
      "Daily: check flames, skin temperatures, O₂ and draft.",
      "Quarterly: O₂ analyzer calibration; burner tip inspection.",
      "Each turnaround: tube thickness and creep inspection; refractory repair.",
    ],
    safety: [
      "Follow the light-off sequence and purge requirements; never relight a hot firebox without a purge.",
    ],
  },
  {
    key: "CDU",
    name: "Crude Distillation Column",
    service:
      "atmospheric crude distillation units with overhead condensing, pumparound and preheat-train circuits",
    specFields: [
      "Capacity",
      "Column diameter",
      "Trays / packing",
      "Overhead system",
      "Preheat train",
    ],
    variants: [
      {
        mfr: "Tidewater Process Equipment",
        model: "TPE-ADU-250",
        specs: [
          "250 kbbl/d",
          "8.5 m",
          "48 valve trays",
          "Two-stage condensing",
          "Twin trains, 14 exchangers",
        ],
        plants: ["Port Arthur"],
      },
      {
        mfr: "Tidewater Process Equipment",
        model: "TPE-ADU-120",
        specs: [
          "120 kbbl/d",
          "6.0 m",
          "42 valve trays",
          "Single-stage condensing",
          "Single train, 10 exchangers",
        ],
        plants: ["Port Arthur"],
      },
    ],
    limits: [
      "Column top pressure: normal 1.2–1.6 bar(g); relief valves set at 3.5 bar(g).",
      "Overhead temperature must stay above the water dew point plus 15 °C to avoid corrosion.",
      "Column differential pressure rising more than 20% above design indicates flooding.",
    ],
    faults: [
      {
        title: "Crude column top pressure high — check overhead condenser",
        causes: [
          "Overhead condenser fouling or cooling loss",
          "Non-condensable gas accumulation",
          "Reflux drum level high",
        ],
        steps: [
          "Check the condenser outlet temperature and cooling-water or air-fan status.",
          "Vent non-condensables to flare via the pressure controller.",
          "Confirm the reflux drum level and sour-water draw.",
          "Reduce feed rate if pressure approaches the alarm limit.",
        ],
        tags: ["CDU.TOP_PRESS", "Overhead temp"],
      },
      {
        title: "Preheat-train fouling — schedule exchanger clean",
        causes: [
          "Asphaltene or salt deposition",
          "Poor desalter performance",
          "Low velocity in bypassed exchangers",
        ],
        steps: [
          "Calculate fouling factors from inlet and outlet temperatures for each exchanger.",
          "Rank exchangers by lost heat recovery and plan cleaning of the worst.",
          "Check desalter efficiency (salt in/out) and wash-water rate.",
        ],
        tags: ["CDU.FEED_TEMP"],
      },
      {
        title: "Reboiler or heater outlet temperature deviation",
        causes: [
          "Heater control loop tuning",
          "Fuel-gas quality change",
          "Feed composition change",
        ],
        steps: [
          "Review the outlet temperature controller and fuel-gas Wobbe index.",
          "Retune the controller if it oscillates.",
        ],
        tags: ["CDU.FEED_TEMP"],
      },
      {
        title: "Tray flooding (high differential pressure)",
        causes: ["Excessive vapour or liquid load", "Tray fouling or damage", "Foaming"],
        steps: [
          "Reduce feed or stripping steam until differential pressure stabilizes.",
          "Run a gamma scan to locate damaged or flooded trays.",
        ],
        tags: ["Column dP"],
      },
    ],
    pm: [
      "Daily: monitor overhead corrosion indicators (pH, chlorides, iron).",
      "Monthly: exchanger fouling trend review.",
      "Each turnaround: tray inspection and overhead line thickness survey.",
    ],
    safety: [
      "Vessel entry requires gas-free certification, isolation by blinds and a confined-space permit.",
    ],
  },
  {
    key: "LNG",
    name: "LNG Liquefaction Train",
    service:
      "mixed-refrigerant liquefaction trains with brazed-aluminium cold boxes and boil-off gas handling",
    specFields: [
      "Capacity",
      "Process",
      "Main heat exchanger",
      "Refrigerant drivers",
      "BOG handling",
    ],
    variants: [
      {
        mfr: "Sabine Cryogenics",
        model: "SC-MR 4.5",
        specs: [
          "4.5 Mtpa",
          "Propane-precooled mixed refrigerant",
          "Spiral-wound main cryogenic heat exchanger",
          "2 × 40 MW gas turbines",
          "2 × BOG compressors",
        ],
        plants: ["Sabine Pass"],
      },
      {
        mfr: "Sabine Cryogenics",
        model: "SC-SMR 1.5",
        specs: [
          "1.5 Mtpa",
          "Single mixed refrigerant",
          "Brazed-aluminium cold box",
          "1 × 25 MW gas turbine",
          "1 × BOG compressor",
        ],
        plants: ["Sabine Pass"],
      },
    ],
    limits: [
      "Cold-box temperature difference between adjacent streams must stay below 30 °C to avoid thermal stress.",
      "Feed gas CO₂ must stay below 50 ppm and water below 1 ppm to prevent freezing.",
      "BOG compressor discharge pressure must remain below the alarm set point.",
    ],
    faults: [
      {
        title: "Liquefaction train cold-box temperature deviation",
        causes: [
          "Mixed-refrigerant composition drift",
          "Maldistribution in the exchanger",
          "Freezing from CO₂ or water breakthrough",
        ],
        steps: [
          "Compare stream temperatures across the cold box with the design profile.",
          "Analyze mixed-refrigerant composition and adjust make-up of light and heavy components.",
          "Check feed CO₂ and water analyzers; if breakthrough is confirmed, reduce rate and regenerate the dehydration beds.",
          "Keep cool-down and warm-up rates within the manufacturer's °C/hour limits.",
        ],
        tags: ["LNG.COLD_TEMP", "LNG.PRESS"],
      },
      {
        title: "Refrigerant compressor seal-gas alarm",
        causes: [
          "Seal-gas filter differential pressure high",
          "Primary seal leakage",
          "Separation-gas loss",
        ],
        steps: [
          "Change over the seal-gas filter.",
          "Trend the primary vent flow and compare with the baseline.",
          "Confirm nitrogen separation-gas supply.",
        ],
        tags: ["Seal gas dP", "Primary vent flow"],
      },
      {
        title: "Boil-off-gas compressor discharge pressure high",
        causes: [
          "Downstream fuel-gas demand drop",
          "Recycle valve fault",
          "High BOG generation (ship loading)",
        ],
        steps: [
          "Check fuel-gas consumers and send excess BOG to the recondenser.",
          "Stroke-test the recycle valve.",
          "Coordinate ship-loading rate with BOG handling capacity.",
        ],
        tags: ["BOG discharge pressure", "LNG.PRESS"],
      },
      {
        title: "Mixed-refrigerant composition drift",
        causes: ["Make-up valve fault", "Leakage of light components", "Analyzer drift"],
        steps: [
          "Validate the gas chromatograph with calibration gas.",
          "Adjust nitrogen, methane, ethane and propane make-up to the target composition.",
        ],
        tags: ["MR composition"],
      },
    ],
    pm: [
      "Daily: review cold-box temperature profile, MR composition and feed analyzers.",
      "Monthly: analyzer calibration.",
      "Each turnaround: dehydration bed replacement; cold-box leak test.",
    ],
    safety: [
      "Cryogenic hazards: wear cold-protection PPE; never trap liquid between closed valves.",
    ],
  },
  {
    key: "TNK",
    name: "Storage Tank",
    service: "atmospheric crude storage tanks with floating roofs and full-containment LNG tanks",
    specFields: ["Capacity", "Type", "Diameter × height", "Roof", "Design code"],
    variants: [
      {
        mfr: "Ironclad Tankworks",
        model: "IT-EFR-500",
        specs: [
          "500 kbbl",
          "Atmospheric crude",
          "82 m × 20 m",
          "External floating roof, double-deck",
          "API 650 / API 653",
        ],
        plants: ["Clovelly Hub"],
      },
      {
        mfr: "Ironclad Tankworks",
        model: "IT-EFR-350",
        specs: [
          "350 kbbl",
          "Atmospheric crude",
          "68 m × 19 m",
          "External floating roof, pontoon",
          "API 650 / API 653",
        ],
        plants: ["Clovelly Hub"],
      },
      {
        mfr: "Sabine Cryogenics",
        model: "SC-FC-160",
        specs: [
          "160,000 m³",
          "Full-containment LNG",
          "82 m × 38 m",
          "Suspended deck, concrete dome",
          "API 625 / EN 14620",
        ],
        plants: ["Sabine Pass"],
      },
    ],
    limits: [
      "Never fill above the high-high level (overfill protection per API 2350).",
      "Floating roof must not land on its legs during normal operation.",
      "LNG tank pressure must stay within 50–250 mbar(g); monitor for density stratification (rollover risk).",
    ],
    faults: [
      {
        title: "Tank floating-roof seal inspection overdue",
        causes: ["Missed inspection interval", "Seal wear or gaps", "Roof tilt"],
        steps: [
          "Schedule the primary and secondary seal gap inspection (annual and 5-year intervals for emissions compliance).",
          "Measure seal gaps and compare with the regulatory limits.",
          "Repair or replace damaged seal sections; check roof drains for blockage.",
        ],
        tags: ["TK.LEVEL"],
      },
      {
        title: "High-level alarm function test overdue",
        causes: ["Missed proof-test", "Level switch fault", "Radar gauge drift"],
        steps: [
          "Perform a proof-test of the independent high-high level switch per API 2350.",
          "Compare the radar gauge with a manual dip.",
          "Record results in the safety-instrumented-function proof-test log.",
        ],
        tags: ["TK.LEVEL"],
      },
      {
        title: "Bund containment integrity inspection due",
        causes: ["Cracks in the bund wall or floor", "Open drain valves", "Vegetation damage"],
        steps: [
          "Inspect the bund wall and floor for cracks and repair.",
          "Confirm bund drain valves are closed and locked.",
        ],
        tags: ["Bund level"],
      },
      {
        title: "Tank level gauge discrepancy",
        causes: [
          "Radar or servo gauge drift",
          "Temperature compensation error",
          "Stilling-well fouling",
        ],
        steps: [
          "Compare with a manual dip and correct the gauge.",
          "Check the temperature element used for volume correction.",
        ],
        tags: ["TK.LEVEL", "TK.TEMP"],
      },
      {
        title: "LNG tank stratification / rollover risk",
        causes: ["Filling with LNG of a different density", "Low circulation", "High heat ingress"],
        steps: [
          "Review the density profile from the level-temperature-density gauge.",
          "Use top or bottom filling to mix layers; run the in-tank pumps in recirculation.",
        ],
        tags: ["TK.TEMP", "Density profile"],
      },
    ],
    pm: [
      "Monthly: external visual inspection; roof drain check.",
      "Annually: seal gap inspection; high-level proof-test.",
      "Per API 653: out-of-service internal inspection (typically every 10–20 years).",
    ],
    safety: [
      "Floating-roof access requires a gas test and a standby person; never access the roof during lightning risk.",
    ],
  },
  {
    key: "PPL",
    name: "Pipeline & Pigging",
    service:
      "subsea and onshore crude export pipelines with pig launchers and receivers and cathodic protection",
    specFields: ["Length", "Diameter", "MAOP", "Service", "Cathodic protection"],
    variants: [
      {
        mfr: "Meridian Pipeline Services",
        model: "MPS-48-EX",
        specs: ["70 km", "48 in", "100 bar", "Crude export", "Sacrificial anodes + ICCP"],
        plants: ["Louisiana Offshore"],
      },
      {
        mfr: "Meridian Pipeline Services",
        model: "MPS-24-IF",
        specs: ["32 km", "24 in", "140 bar", "Multiphase infield", "Sacrificial anodes"],
        plants: ["West Delta", "Mars-Ursa"],
      },
    ],
    limits: [
      "Never exceed MAOP; the pressure safety high trips the inlet pumps.",
      "Cathodic-protection potential must stay between -850 mV and -1,100 mV versus Ag/AgCl.",
      "Line-balance (mass in minus mass out) alarm at 0.5% of flow sustained for 15 minutes.",
    ],
    faults: [
      {
        title: "Line pressure drop — investigate for leak",
        causes: ["Leak or rupture", "Upstream pump trip", "Meter or transmitter fault"],
        steps: [
          "Check the line-balance and leak-detection system for a mass imbalance.",
          "Verify inlet pump status and pressure transmitters.",
          "If a leak is suspected, shut down, isolate the segment and notify the control room and regulator per the emergency plan.",
          "Dispatch an aerial or ROV survey along the route.",
        ],
        tags: ["PL.PRESS", "PL.FLOW"],
      },
      {
        title: "Pig launcher/receiver valve fault",
        causes: [
          "Closure door seal damage",
          "Kicker or bypass valve leak-by",
          "Pig signaller fault",
        ],
        steps: [
          "Confirm the barrel is depressurized and vented before opening the closure.",
          "Replace the closure O-ring and check the interlock.",
          "Leak-test the kicker and bypass valves; service if passing.",
        ],
        tags: ["Barrel pressure"],
      },
      {
        title: "Cathodic-protection reading below setpoint",
        causes: ["Anode depletion", "Transformer-rectifier fault", "Coating damage"],
        steps: [
          "Check transformer-rectifier output and alarms.",
          "Carry out a close-interval potential survey on the affected section.",
          "Plan anode retrofit if depletion is confirmed.",
        ],
        tags: ["CP potential"],
      },
      {
        title: "Flow meter imbalance",
        causes: ["Meter drift", "Wax deposition", "Prover fault"],
        steps: [
          "Prove the meters and apply new meter factors.",
          "Run a cleaning pig if wax deposition is suspected.",
        ],
        tags: ["PL.FLOW"],
      },
    ],
    pm: [
      "Continuous: leak-detection monitoring.",
      "Quarterly: cleaning pig runs; CP readings.",
      "Every 5 years: intelligent (in-line inspection) pig survey.",
    ],
    safety: [
      "Pig traps can retain pressure: always verify zero pressure at two independent points before opening.",
    ],
  },
  {
    key: "MLA",
    name: "Marine Loading Arm",
    service: "marine crude loading arms, berth mooring-load monitoring and vapour-recovery units",
    specFields: ["Arm size", "Envelope", "Emergency release", "Drive", "Vapour handling"],
    variants: [
      {
        mfr: "Pelican Marine Systems",
        model: "PMS-16-HD",
        specs: [
          "16 in",
          "±6 m drift, 15 m tide",
          "Powered emergency release coupler (PERC)",
          "Hydraulic",
          "Vapour return arm + VRU",
        ],
        plants: ["Louisiana Offshore"],
      },
      {
        mfr: "Pelican Marine Systems",
        model: "PMS-12-ST",
        specs: ["12 in", "±4 m drift, 10 m tide", "PERC", "Hydraulic", "Vapour return arm"],
        plants: ["Louisiana Offshore"],
      },
    ],
    limits: [
      "Arm must remain within its operating envelope; the first-stage alarm warns before emergency release.",
      "Hydraulic accumulator pressure must remain above the ERS minimum.",
      "Mooring-line loads must stay below 55% of minimum breaking load.",
    ],
    faults: [
      {
        title: "Marine loading-arm hydraulic leak",
        causes: ["Hose or fitting failure", "Cylinder seal wear", "Over-pressure"],
        steps: [
          "Stop arm movement, contain the spill and identify the leak source.",
          "Replace the failed hose or seal and pressure-test.",
          "Verify accumulator pre-charge and ERS function before returning to service.",
        ],
        tags: ["Hydraulic pressure"],
      },
      {
        title: "Berth mooring-load monitoring fault",
        causes: ["Load cell failure", "Cable damage", "Display unit fault"],
        steps: [
          "Compare quick-release hook load readings with manual tension estimates.",
          "Replace the failed load pin; recalibrate the system.",
        ],
        tags: ["Mooring load"],
      },
      {
        title: "Vapor-recovery unit trip",
        causes: ["Compressor or blower trip", "High inlet pressure", "Carbon bed saturation"],
        steps: [
          "Pause loading or reduce rate per the vapour-emission permit.",
          "Read the VRU trip cause and reset after correction.",
          "Regenerate or replace the carbon beds if breakthrough is detected.",
        ],
        tags: ["BERTH.RATE", "VRU inlet pressure"],
      },
      {
        title: "Swivel joint leak",
        causes: ["Seal wear", "Bearing damage"],
        steps: ["Replace swivel seals; inspect bearings for brinelling."],
        tags: ["BERTH.PRESS"],
      },
    ],
    pm: [
      "Before each loading: ERS and arm envelope alarm test.",
      "Monthly: hydraulic oil sample; swivel inspection.",
      "Annually: full ERS function test and load-pin calibration.",
    ],
    safety: ["Never stand under a suspended arm; follow the ship-shore safety checklist."],
  },
  {
    key: "PLT",
    name: "Offshore Platform & Risers",
    service:
      "fixed jackets and tension-leg platforms, topsides structure, risers and firewater systems",
    specFields: ["Platform type", "Water depth", "Design life", "Risers", "Firewater"],
    variants: [
      {
        mfr: "Gulfstar Subsea Systems",
        model: "GS-Jacket-4L",
        specs: [
          "4-leg fixed jacket",
          "45 m",
          "30 years",
          "6 × 10 in production, 1 × 16 in export",
          "2 × diesel firewater pumps, deluge",
        ],
        plants: ["West Delta"],
      },
      {
        mfr: "Gulfstar Subsea Systems",
        model: "GS-TLP-900",
        specs: [
          "Tension-leg platform",
          "900 m",
          "25 years",
          "Top-tensioned production risers, steel catenary export",
          "3 × firewater pumps, deluge and foam",
        ],
        plants: ["Mars-Ursa"],
      },
    ],
    limits: [
      "Topside vibration: alarm at 10 mm/s on structural accelerometers.",
      "Riser wall-loss must remain below the corrosion allowance (typically 3 mm).",
      "Firewater deluge test interval: quarterly (per facility safety case).",
    ],
    faults: [
      {
        title: "Topside structural vibration exceedance — inspect brace welds",
        causes: [
          "Rotating equipment resonance",
          "Fatigue cracking at brace welds",
          "Storm loading",
        ],
        steps: [
          "Identify the frequency band and correlate with rotating equipment speeds.",
          "Perform close visual and MPI (magnetic particle) inspection of brace welds in the affected area.",
          "Install vibration isolation or retune the equipment if resonance is confirmed.",
        ],
        tags: ["STRUCT.VIBR"],
      },
      {
        title: "Riser corrosion monitoring reading out of range",
        causes: ["Splash-zone coating damage", "Internal corrosion (CO₂/H₂S)", "Probe fault"],
        steps: [
          "Compare corrosion probe or coupon readings with the last UT thickness survey.",
          "Increase corrosion inhibitor dosage and verify residuals.",
          "Schedule rope-access UT inspection of the splash zone.",
        ],
        tags: ["RISER.PRESS", "Corrosion rate"],
      },
      {
        title: "Firewater deluge system test overdue",
        causes: ["Missed test scheduling", "Nozzle blockage", "Deluge valve fault"],
        steps: [
          "Schedule the deluge flow test with operations.",
          "Check nozzle coverage and clear blocked nozzles.",
          "Record pump start time and pressure; repair any deluge valve that fails to open.",
        ],
        tags: ["Firewater pressure"],
      },
      {
        title: "Riser pressure anomaly",
        causes: ["Slugging", "Hydrate blockage", "Transmitter fault"],
        steps: [
          "Review riser base and top pressure trends for slug patterns.",
          "Adjust topside choke or gas lift to stabilize flow.",
        ],
        tags: ["RISER.PRESS"],
      },
    ],
    pm: [
      "Quarterly: deluge test; corrosion monitoring review.",
      "Annually: topsides structural walk-down.",
      "Every 4–5 years: underwater ROV or diver inspection of the jacket or tendons and risers.",
    ],
    safety: ["Over-water work requires fall protection and a standby vessel or rescue boat."],
  },
];

// ---------------------------------------------------------------------------------------------
// Corpus construction (same record shape as report-app/server/manuals.json)
// ---------------------------------------------------------------------------------------------
function buildMarkdown(cat, v, id) {
  const title = `${v.mfr} ${cat.name} — Model ${v.model} Operation & Maintenance Manual`;
  const lines = [];
  lines.push(`# ${title}`, "");
  lines.push(
    `**Document ID:** ${id}  `,
    `**Manufacturer:** ${v.mfr} (fictional)  `,
    `**Model:** ${v.model}  `,
    `**Equipment category:** ${cat.name}`,
    "",
  );
  lines.push(
    "> Synthetic reference manual generated for the OneRig (OneGrid Oil & Gas) demonstration. It mimics the structure of a real O&M manual but contains no proprietary OEM content.",
    "",
  );
  lines.push(
    "## 1. Overview",
    `This manual covers ${cat.service}. It describes safe operation, operating limits, troubleshooting and preventive maintenance for the ${v.model}.`,
    "",
  );
  lines.push("## 2. Specifications", "| Field | Value |", "| --- | --- |");
  cat.specFields.forEach((f, i) => lines.push(`| ${f} | ${v.specs[i]} |`));
  lines.push("");
  lines.push("## 3. Operating limits & protection", ...cat.limits.map((l) => `- ${l}`), "");
  lines.push(
    "## 4. Startup (summary)",
    "1. Confirm utilities, instrumentation and protection systems are healthy and all permissives are met.",
    "2. Verify isolations are removed and the work permit is closed out.",
    "3. Bring the equipment on line within the limits in Section 3.",
    "4. Monitor the signals listed in Section 5 until stable.",
    "",
  );
  lines.push("## 5. Troubleshooting & work-order resolution");
  cat.faults.forEach((f, i) => {
    lines.push(
      `#### F${i + 1}. ${f.title}`,
      "",
      "**Likely causes**",
      ...f.causes.map((c) => `- ${c}`),
      "",
      "**Recommended resolution**",
      ...f.steps.map((s, k) => `${k + 1}. ${s}`),
      "",
      `**Related tags/signals:** ${f.tags.join(", ")}`,
      "",
    );
  });
  lines.push("## 6. Preventive maintenance", ...cat.pm.map((p) => `- ${p}`), "");
  lines.push(
    "## 7. Shutdown (summary)",
    "1. Reduce load or flow within the allowed ramp rates.",
    "2. Isolate, depressurize and make safe per the isolation procedure.",
    "3. Record final readings and any abnormal indications for the log.",
    "",
  );
  lines.push("## 8. Safety", ...cat.safety.map((s) => `- ${s}`), "");
  return { title, md: lines.join("\n") };
}

const CORPUS = [];
for (const cat of CATEGORIES) {
  cat.variants.forEach((v, i) => {
    const id = `MAN-OG-${cat.key}-${String(i + 1).padStart(3, "0")}`;
    const { title, md } = buildMarkdown(cat, v, id);
    CORPUS.push({
      id,
      title,
      manufacturer: v.mfr,
      model: v.model,
      equipment_category: cat.name,
      applies_to_plants: v.plants,
      fault_symptoms: cat.faults.map((f) => f.title),
      related_tags: [...new Set(cat.faults.flatMap((f) => f.tags))],
      body_markdown: md,
    });
  });
}

export const OG_MANUAL_CATEGORIES = CATEGORIES.map((c) => c.name).sort();

// Map an O&G asset to a manual category. The sample estate's asset type (sample.js OG_FACILITIES
// `type`) is authoritative; otherwise equipment words in the name win over location words
// (e.g. "Mars TLP Compressor Turbine" is a turbine, "Tank Farm Transfer Pump" is a pump), and
// problem keywords are the last resort.
const TYPE_MAP = {
  well: "Wellhead & Christmas Tree",
  turbine: "Gas Turbine & Compressor",
  pump: "Centrifugal Pump",
  generator: "Turbo-Generator",
  boiler: "Fired Heater",
  heater: "Fired Heater",
  refinery: "Crude Distillation Column",
  lng_terminal: "LNG Liquefaction Train",
  storage: "Storage Tank",
  pipeline: "Pipeline & Pigging",
  port: "Marine Loading Arm",
  offshore_platform: "Offshore Platform & Risers",
};
const RULES = [
  ["Wellhead & Christmas Tree", /(wellhead|xmas|christmas tree|\bwell\b|scssv)/],
  ["Centrifugal Pump", /(pump|mechanical seal|recirculation valve)/],
  ["Turbo-Generator", /(\bgenerator\b|turbo-?generator|stator|\bavr\b|excitation)/],
  ["Gas Turbine & Compressor", /(turbine|compressor|surge|exhaust-gas|seal-gas)/],
  ["Fired Heater", /(fired heater|furnace|\bheater\b|burner|tube skin)/],
  ["Storage Tank", /(storage tank|\btank\b|floating[- ]roof|\bbund\b)/],
  ["LNG Liquefaction Train", /(liquefaction|\blng\b|cold[- ]?box|mixed[- ]refrigerant)/],
  ["Pipeline & Pigging", /(pipeline|\bpig\b|pig launcher|cathodic)/],
  [
    "Marine Loading Arm",
    /(berth|marine terminal|loading[- ]arm|jetty|vapou?r[- ]recovery|mooring)/,
  ],
  [
    "Crude Distillation Column",
    /(distillation|\bcdu\b|crude unit|crude column|preheat[- ]train|reboiler)/,
  ],
  ["Offshore Platform & Risers", /(platform|\btlp\b|jacket|\briser|deluge|brace weld)/],
];
export function ogCategoryFor({
  name = "",
  assetType = "",
  kind = "",
  category = "",
  problem = "",
} = {}) {
  for (const t of [kind, assetType, category]) {
    const hit =
      TYPE_MAP[
        String(t || "")
          .toLowerCase()
          .trim()
      ];
    if (hit) return hit;
  }
  const assetHay = `${category} ${assetType} ${name}`.toLowerCase();
  for (const [cat, re] of RULES) if (re.test(assetHay)) return cat;
  const probHay = String(problem).toLowerCase();
  for (const [cat, re] of RULES) if (re.test(probHay)) return cat;
  return null;
}

function splitSections(md) {
  const out = [];
  let cur = { section: "Overview", body: "" };
  for (const line of String(md || "").split("\n")) {
    const h = line.match(/^#{1,4}\s+(.*\S)\s*$/);
    if (h) {
      if (cur.body.trim()) out.push(cur);
      cur = { section: h[1].replace(/^\d+[.)]\s*/, "").trim(), body: "" };
    } else {
      cur.body += line + "\n";
    }
  }
  if (cur.body.trim()) out.push(cur);
  return out;
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "check",
  "inspect",
  "investigate",
  "high",
  "low",
  "schedule",
  "overdue",
  "due",
]);

// Offline keyword grounding (same scoring approach and result shape as the report-app server).
export function searchOgManuals(query, { category = null, top = 5 } = {}) {
  const terms = [
    ...new Set(
      (
        String(query || "")
          .toLowerCase()
          .match(/[a-z0-9₂]{3,}/g) || []
      ).filter((t) => !STOP.has(t)),
    ),
  ];
  const pool = CORPUS.filter((m) => !category || m.equipment_category === category);
  const scored = [];
  for (const m of pool) {
    const symptomHay = `${m.fault_symptoms.join(" ")} ${m.related_tags.join(" ")}`.toLowerCase();
    const mBoost = terms.reduce((s, t) => s + (symptomHay.includes(t) ? 1 : 0), 0);
    for (const sec of splitSections(m.body_markdown)) {
      const hay = `${sec.section} ${sec.body}`.toLowerCase();
      let score = mBoost;
      for (const t of terms) if (hay.includes(t)) score += 1;
      // Fault entries (F1..F5) are the work-order resolution passages: weight title hits highly.
      if (/^F\d+\./.test(sec.section)) {
        score += 2;
        const head = sec.section.toLowerCase();
        for (const t of terms) if (head.includes(t)) score += 3;
      }
      if (score > 0) {
        scored.push({
          manual_id: m.id,
          title: m.title,
          manufacturer: m.manufacturer,
          model: m.model,
          category: m.equipment_category,
          section: sec.section,
          snippet: sec.body
            .trim()
            .replace(/\n{3,}/g, "\n\n")
            .slice(0, 900),
          score,
        });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) {
    for (const m of pool.slice(0, 3)) {
      const ts = splitSections(m.body_markdown).find((s) => /^F1\./.test(s.section));
      if (ts)
        scored.push({
          manual_id: m.id,
          title: m.title,
          manufacturer: m.manufacturer,
          model: m.model,
          category: m.equipment_category,
          section: ts.section,
          snippet: ts.body.trim().slice(0, 900),
          score: 1,
        });
    }
  }
  // Prefer one passage per manual so the modal shows guidance from distinct manuals first.
  const firstPer = [];
  const seen = new Set();
  for (const s of scored)
    if (!seen.has(s.manual_id)) {
      seen.add(s.manual_id);
      firstPer.push(s);
    }
  const rest = scored.filter((s) => !firstPer.includes(s));
  return [...firstPer, ...rest].slice(0, top);
}

export function resolveOgWorkOrder({ category = null, asset = {}, problem = "", top = 4 } = {}) {
  const cat = category || ogCategoryFor({ ...asset, problem });
  const q =
    (problem && problem.trim()) ||
    `common faults and recommended resolution for ${cat || "oil and gas equipment"}`;
  const hits = searchOgManuals(q, { category: cat, top });
  const seen = new Set();
  const manuals = [];
  for (const h of hits) {
    if (seen.has(h.manual_id)) continue;
    seen.add(h.manual_id);
    manuals.push({
      id: h.manual_id,
      title: h.title,
      manufacturer: h.manufacturer,
      model: h.model,
      category: h.category,
    });
  }
  return { category: cat, query: q, manuals, passages: hits };
}

export function getOgManual(id) {
  return CORPUS.find((m) => m.id === id) || null;
}

export function ogManualsForCategory(category) {
  return CORPUS.filter((m) => m.equipment_category === category).map((m) => ({
    id: m.id,
    title: m.title,
    manufacturer: m.manufacturer,
    model: m.model,
    category: m.equipment_category,
  }));
}

// Route handler for the client-side sample provider (same paths and shapes as report-app).
export function resolveOgManualsRoute(p, params) {
  if (p === "/api/manuals/health") return { enabled: true, categories: OG_MANUAL_CATEGORIES };
  if (p === "/api/manuals/search") {
    const q = params.get("q") || "";
    const category = params.get("category") || null;
    return { results: searchOgManuals(q, { category, top: Number(params.get("top")) || 5 }) };
  }
  if (p.startsWith("/api/manuals/category/"))
    return {
      manuals: ogManualsForCategory(decodeURIComponent(p.slice("/api/manuals/category/".length))),
    };
  if (p.startsWith("/api/manuals/item/")) {
    const m = getOgManual(decodeURIComponent(p.slice("/api/manuals/item/".length)));
    return m || { error: "manual not found" };
  }
  if (p === "/api/manuals/resolve") {
    const asset = {
      kind: params.get("assetKind") || "",
      category: params.get("assetCategory") || "",
      name: params.get("assetName") || "",
      assetType: params.get("assetType") || "",
    };
    return resolveOgWorkOrder({
      category: params.get("category") || null,
      asset,
      problem: params.get("problem") || "",
    });
  }
  return null;
}

export const OG_MANUALS = CORPUS;
