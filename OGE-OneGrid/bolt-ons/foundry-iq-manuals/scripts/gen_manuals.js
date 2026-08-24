// Synthetic equipment-manual corpus generator for OneGrid / Foundry IQ.
// Produces ~100 realistic-but-fictional manuals (no OEM text copied — safe for demos)
// aligned to the OneGrid ontology equipment categories. Each manual has structured
// sections plus a rich, category-specific troubleshooting library (fault -> cause ->
// resolution + related tags) that grounds the "how do I resolve this work order?" flow.
//
// Output: corpus/manuals.json  (array of manual objects with body_markdown + body_text)
// Run:    node scripts/gen_manuals.js

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'corpus');
fs.mkdirSync(OUT, { recursive: true });

// Fictional manufacturers (clearly not real OEMs) so there is zero IP risk.
const MAKERS = [
  'Meridian Thermal Systems', 'Cascade Rotating Equipment', 'Ironhart Power Components',
  'Northwind Heat Transfer', 'Vantage Turbomachinery', 'Summit Boilerworks',
  'Delta Ridge Controls', 'Aurora Mechanical', 'Keystone Fluid Systems', 'Halcyon Energy Equipment',
];

const rnd = (seed) => { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const range = (r, a, b, dec = 0) => (a + r() * (b - a)).toFixed(dec);

// Each category: how many models, spec builder, operating limits, procedures, faults, PM tasks.
const CATEGORIES = [
  {
    key: 'Boiler', count: 16, tag: 'BLR',
    specs: (r) => ([
      ['Type', pick(r, ['Subcritical drum', 'Supercritical once-through', 'Natural circulation drum'])],
      ['Max continuous rating', `${range(r, 250, 1200)} t/h steam`],
      ['Design pressure', `${range(r, 130, 250)} bar`],
      ['Superheater outlet temp', `${range(r, 540, 600)} °C`],
      ['Fuel', pick(r, ['Pulverized coal', 'Natural gas', 'Dual-fuel gas/oil'])],
    ]),
    limits: [
      'Drum level: maintain within ±50 mm of normal water level (NWL). Trip on ±250 mm.',
      'Furnace pressure: -2.5 to +2.5 kPa. MFT (master fuel trip) outside ±3.5 kPa.',
      'Superheater outlet temperature must not exceed the design limit for more than 15 minutes.',
      'Minimum firing rate 25% MCR to maintain stable flame and circulation.',
    ],
    faults: [
      { symptom: 'High drum level / level valve demand saturating', causes: ['Feedwater control valve stiction or miscalibration', 'Shrink-swell during rapid load change', 'Failed level transmitter (reference leg)'], steps: ['Switch three-element control to manual and stabilize level.', 'Compare all three drum-level transmitters; reject the outlier.', 'Stroke-test the feedwater control valve for stiction; recalibrate positioner.', 'If transmitter reference leg is suspect, refill/verify the condensate pot.'], tags: ['Heater Lvl Vv', 'Drum Level', 'Feedwater Flow'] },
      { symptom: 'Furnace pressure excursions / draft instability', causes: ['ID/FD fan control interaction', 'Sudden fuel trip', 'Damper linkage backlash'], steps: ['Verify ID/FD fan master is in auto and coordinated.', 'Inspect damper linkages for backlash and re-tension.', 'Check furnace pressure transmitters against a common reference.'], tags: ['Furnace Press', 'ID Fan', 'FD Fan'] },
      { symptom: 'Superheater outlet overtemperature', causes: ['Attemperator (desuperheater) spray valve failure', 'Fouled/fireside slagging shifting heat absorption', 'Excess air / burner tilt'], steps: ['Confirm attemperator spray valve strokes fully and water is available.', 'Reduce burner tilt / trim excess O2 toward target.', 'Schedule sootblowing of the affected superheater bank.'], tags: ['SH Outlet Temp', 'Spray Vv', 'O2'] },
      { symptom: 'Loss of flame / MFT on low fuel', causes: ['Flame scanner fouling', 'Fuel supply pressure dip', 'Burner air register maldistribution'], steps: ['Clean/verify flame scanners and sighting tubes.', 'Check fuel gas/oil supply pressure against low-pressure trip setpoint.', 'Balance burner air registers per the light-off sequence.'], tags: ['Flame Scanner', 'Fuel Press', 'Burner'] },
      { symptom: 'Rising tube-metal temperatures', causes: ['Internal deposition / scale', 'Localized overfiring', 'Low mass flow at part load'], steps: ['Trend tube-metal thermocouples; identify the hottest circuit.', 'Review water chemistry logs for carryover/deposition.', 'Raise minimum flow or rebalance firing to protect the circuit.'], tags: ['Tube Metal Temp', 'Steam Flow'] },
    ],
    pm: ['Weekly: sootblower operation check and drum-level transmitter cross-check.', 'Monthly: attemperator spray valve stroke test; flame scanner cleaning.', 'Outage: internal inspection for tube thinning, deposition, and refractory condition.'],
  },
  {
    key: 'Boiler Feed Pump', count: 14, tag: 'BFP',
    specs: (r) => ([
      ['Type', pick(r, ['Multistage barrel (BB5)', 'Horizontal split-case (BB3)'])],
      ['Rated flow', `${range(r, 300, 1400)} m³/h`],
      ['Rated head', `${range(r, 1800, 3200)} m`],
      ['Driver', pick(r, ['Variable-speed electric + hydraulic coupling', 'Steam-turbine driven'])],
      ['Seal', pick(r, ['Mechanical cartridge seal', 'Floating-ring seal'])],
    ]),
    limits: [
      'Minimum continuous flow: keep above the recirculation setpoint to prevent thermal damage.',
      'Suction pressure must stay above NPSH-required margin to avoid cavitation.',
      'Bearing temperature alarm 90 °C, trip 100 °C. Vibration alarm 4.5 mm/s, trip 7.1 mm/s.',
    ],
    faults: [
      { symptom: 'High vibration on the pump / driver train', causes: ['Coupling misalignment', 'Rotor unbalance or bowed shaft', 'Bearing wear or oil-whirl', 'Cavitation from low suction'], steps: ['Confirm the reading on a second channel; check for looseness first.', 'Verify hot alignment; re-shim if offset exceeds tolerance.', 'Check suction pressure/NPSH margin; open recirc if starved.', 'Inspect journal bearings and oil supply temperature/pressure.'], tags: ['NLOAD', 'Vibration', 'Bearing', 'Suction Press'] },
      { symptom: 'Bearing temperature rising toward trip', causes: ['Low or hot lube-oil supply', 'Bearing wear / metal-to-metal', 'Cooling-water loss to oil cooler'], steps: ['Verify lube-oil supply pressure and cooler outlet temperature.', 'Confirm oil-cooler cooling-water flow is established.', 'Trend the temperature; if still climbing, reduce load and plan a stop.'], tags: ['Bearing Temp', 'Oil Press', 'Cooling Water'] },
      { symptom: 'Seal leakage / seal-water flow abnormal', causes: ['Worn mechanical seal faces', 'Loss of seal flush / plugged orifice', 'Excessive shaft deflection'], steps: ['Check seal flush flow and filter for plugging.', 'Inspect seal faces and secondary O-rings for wear.', 'Verify shaft runout is within tolerance.'], tags: ['Seal Flow', 'Seal Press'] },
      { symptom: 'Insufficient discharge head / low flow', causes: ['Internal wear-ring clearance opened up', 'Recirculation valve stuck open', 'Air ingress on suction'], steps: ['Confirm the recirculation valve position and stroke it closed.', 'Check for suction air ingress and vent the casing.', 'If head deficit persists, plan a wear-ring clearance inspection.'], tags: ['Discharge Press', 'Recirc Vv', 'Flow'] },
    ],
    pm: ['Daily: bearing temperature and vibration trend review.', 'Monthly: lube-oil sample and cooler performance check.', 'Annual: laser alignment verification and seal condition inspection.'],
  },
  {
    key: 'Steam Turbine', count: 14, tag: 'STG',
    specs: (r) => ([
      ['Configuration', pick(r, ['Tandem-compound HP/IP/LP', 'Single-cylinder condensing', 'Cross-compound'])],
      ['Rated output', `${range(r, 60, 720)} MW`],
      ['Throttle steam', `${range(r, 120, 250)} bar / ${range(r, 540, 600)} °C`],
      ['Speed', '3000 rpm (50 Hz)'],
    ]),
    limits: [
      'Bearing metal temperature alarm 100 °C, trip 115 °C.',
      'Shaft vibration alarm 125 µm, trip 250 µm (peak-peak).',
      'Differential expansion and axial position must remain within the OEM envelope.',
      'Observe cold/warm/hot start ramp rates to control rotor thermal stress.',
    ],
    faults: [
      { symptom: 'Rising shaft vibration', causes: ['Thermal bow after trip / uneven cooling', 'Bearing instability (oil whirl)', 'Rub or unbalance from deposits'], steps: ['Check for eccentricity/bow before restart; use turning gear per schedule.', 'Verify bearing oil supply temperature and pressure.', 'Trend 1x/2x vibration components to distinguish unbalance from rub.'], tags: ['Vibration', 'Shaft', 'Eccentricity'] },
      { symptom: 'Bearing metal temperature high', causes: ['Reduced oil flow or high oil-inlet temperature', 'Babbitt wear', 'High thrust load / axial shift'], steps: ['Verify lube-oil header pressure and cooler outlet temperature.', 'Check axial position / thrust bearing wear indicator.', 'Reduce load and monitor; prepare an orderly shutdown if trending up.'], tags: ['Bearing Metal Temp', 'Oil Temp', 'Axial Pos'] },
      { symptom: 'High differential expansion', causes: ['Start ramp too fast for metal temperature', 'Gland steam / cooling imbalance', 'Casing drain issue'], steps: ['Slow the load/temperature ramp to the allowed rate.', 'Verify gland steam temperature and casing drains are open on start.', 'Hold load and soak until differential expansion returns to band.'], tags: ['Diff Exp', 'Metal Temp'] },
      { symptom: 'Overspeed test failure / governor hunting', causes: ['Control-oil contamination', 'Servo valve wear', 'Speed probe fault'], steps: ['Sample and filter control oil; verify cleanliness.', 'Check redundant speed probes for agreement.', 'Bench-test the servo/actuator and re-stroke.'], tags: ['Speed', 'Control Oil', 'Governor'] },
    ],
    pm: ['Each start: eccentricity and differential-expansion checks before rolling.', 'Monthly: lube/control-oil sampling; overspeed trip channel test per schedule.', 'Outage: bearing inspection, blade/deposit inspection, alignment verification.'],
  },
  {
    key: 'Generator', count: 10, tag: 'GEN',
    specs: (r) => ([
      ['Cooling', pick(r, ['Hydrogen-cooled', 'Air-cooled', 'Water-cooled stator / H2 rotor'])],
      ['Rated MVA', `${range(r, 80, 850)} MVA`],
      ['Terminal voltage', `${range(r, 11, 27)} kV`],
      ['Excitation', pick(r, ['Static excitation', 'Brushless exciter'])],
    ]),
    limits: [
      'Stator winding temperature alarm per class; keep within the capability curve.',
      'Hydrogen purity ≥ 95% and casing pressure within band (H2-cooled units).',
      'Operate within the reactive capability (P-Q) curve; respect field-current limit.',
    ],
    faults: [
      { symptom: 'Stator temperature high', causes: ['Cooling gas/water flow reduced', 'Overload beyond capability curve', 'Blocked cooling passages'], steps: ['Verify cooler cooling-water flow and gas/water temperature.', 'Reduce reactive/real load back within the capability curve.', 'Check for cooler fouling and plan cleaning.'], tags: ['Stator Temp', 'Cooling Water', 'MW'] },
      { symptom: 'Hydrogen purity / pressure dropping', causes: ['Seal-oil system upset', 'Casing/cooler leak', 'Purity meter fault'], steps: ['Check seal-oil differential pressure and detraining.', 'Leak-test casing and cooler tubes.', 'Cross-check purity analyzers.'], tags: ['H2 Purity', 'H2 Press', 'Seal Oil'] },
      { symptom: 'Excitation / AVR instability', causes: ['AVR tuning or sensing loss', 'Field ground', 'PSS interaction'], steps: ['Verify voltage-sensing inputs to the AVR.', 'Run field-ground detection; inspect for insulation degradation.', 'Review AVR/PSS settings against commissioning records.'], tags: ['Field Current', 'Terminal V', 'AVR'] },
    ],
    pm: ['Weekly: hydrogen purity/pressure and seal-oil review (H2 units).', 'Annual: partial-discharge trend, cooler performance, protection channel tests.'],
  },
  {
    key: 'Surface Condenser', count: 9, tag: 'CND',
    specs: (r) => ([
      ['Type', pick(r, ['Single-pass', 'Two-pass'])],
      ['Duty', `${range(r, 150, 900)} MWth`],
      ['Design back-pressure', `${range(r, 40, 90)} mbar(a)`],
      ['Tube material', pick(r, ['Titanium', 'Stainless 304L', 'Admiralty brass'])],
    ]),
    limits: [
      'Condenser back-pressure must stay below the turbine exhaust-hood trip limit.',
      'Hotwell level within band; conductivity within chemistry limits (tube-leak indicator).',
      'Air in-leakage below the design air-removal capacity.',
    ],
    faults: [
      { symptom: 'Rising condenser back-pressure (poor vacuum)', causes: ['Air in-leakage', 'Cooling-water flow/temperature high', 'Tube fouling', 'Air-removal (SJAE/vacuum pump) underperforming'], steps: ['Run a helium/air in-leakage survey on the vacuum boundary.', 'Verify cooling-water flow and inlet temperature.', 'Check air-removal equipment capacity and holding.', 'Plan tube cleaning if terminal temperature difference is high.'], tags: ['Backpressure', 'Vacuum', 'CW Flow'] },
      { symptom: 'Rising hotwell conductivity', causes: ['Condenser tube leak', 'Cooling-water ingress', 'Makeup chemistry upset'], steps: ['Cross-check conductivity and sodium analyzers.', 'Perform per-section isolation to locate the leaking bundle.', 'Plug the leaking tube(s) at the next opportunity.'], tags: ['Conductivity', 'Hotwell Level'] },
    ],
    pm: ['Monthly: air in-leakage check and air-removal performance test.', 'Outage: tube cleaning, eddy-current inspection, waterbox inspection.'],
  },
  {
    key: 'Economizer', count: 8, tag: 'ECO',
    specs: (r) => ([
      ['Arrangement', pick(r, ['Bare-tube counterflow', 'Finned-tube'])],
      ['Feedwater inlet', `${range(r, 150, 250)} °C`],
      ['Gas-side ΔP (design)', `${range(r, 0.5, 2.0, 1)} kPa`],
    ]),
    limits: ['Maintain feedwater flow above minimum to avoid steaming in the economizer.', 'Watch gas-side differential pressure for fouling/pluggage.'],
    faults: [
      { symptom: 'Rising gas-side differential pressure', causes: ['Ash pluggage / fouling', 'Sootblower ineffective', 'Bypass damper issue'], steps: ['Increase targeted sootblowing frequency on the economizer.', 'Inspect for ash bridging during the next inspection window.', 'Verify sootblower steam supply and lance operation.'], tags: ['Gas dP', 'FW Flow'] },
      { symptom: 'Economizer steaming / feedwater temperature approach low', causes: ['Low feedwater flow at part load', 'Heat-absorption shift'], steps: ['Raise minimum feedwater flow at low loads.', 'Check upstream heater performance affecting inlet temperature.'], tags: ['FW Temp', 'FW Flow'] },
    ],
    pm: ['Monthly: gas-side dP trend and sootblower coverage review.', 'Outage: tube-bank inspection for erosion/pluggage.'],
  },
  {
    key: 'Air Preheater', count: 6, tag: 'APH',
    specs: (r) => ([
      ['Type', pick(r, ['Regenerative (Ljungström-style rotary)', 'Tubular recuperative'])],
      ['Air/gas duty', `${range(r, 50, 400)} MWth`],
    ]),
    limits: ['Monitor gas-outlet temperature to stay above the acid dew point and avoid cold-end corrosion.', 'Rotor drive current within band (rotary type).'],
    faults: [
      { symptom: 'High air-to-gas leakage', causes: ['Worn radial/axial seals', 'Rotor distortion', 'Seal-setting drift'], steps: ['Measure leakage via O2 rise across the APH.', 'Re-set radial and axial seals to design clearance.', 'Inspect rotor for thermal distortion.'], tags: ['O2 Rise', 'Seal'] },
      { symptom: 'Cold-end fouling / rising dP', causes: ['Acid-dew-point deposition', 'Ineffective sootblowing/washing'], steps: ['Raise cold-end average temperature via air bypass/steam coil.', 'Schedule sootblowing or a water wash.', 'Trend element pressure drop.'], tags: ['APH dP', 'Cold End Temp'] },
    ],
    pm: ['Monthly: leakage (O2 rise) and dP trend.', 'Outage: seal inspection/re-set, element condition check.'],
  },
  {
    key: 'Feedwater Heater', count: 7, tag: 'FWH',
    specs: (r) => ([
      ['Stage', pick(r, ['LP heater', 'HP heater', 'Deaerating heater'])],
      ['Shell design pressure', `${range(r, 5, 80)} bar`],
      ['Terminal temp difference (design)', `${range(r, 1, 5, 1)} °C`],
    ]),
    limits: ['Maintain heater drip/level control within band to protect tubes and avoid flooding.', 'High level can induce water induction to the turbine — respect protection interlocks.'],
    faults: [
      { symptom: 'High heater level / level control hunting', causes: ['Drain valve stiction', 'Level transmitter drift', 'Load-swing induced swell'], steps: ['Switch level control to manual and stabilize.', 'Stroke-test the normal/emergency drain valves.', 'Cross-check level transmitters and re-calibrate the outlier.'], tags: ['Heater Level', 'Drain Vv'] },
      { symptom: 'Poor heater performance / terminal temp difference rising', causes: ['Tube fouling', 'Air blanketing / vent plugged', 'Bypassing on the shell side'], steps: ['Verify continuous vents are open and clear.', 'Check for tube fouling via performance trend.', 'Inspect pass partition / bypass on the next outage.'], tags: ['TTD', 'FW Temp'] },
    ],
    pm: ['Monthly: level-control valve stroke and vent verification.', 'Outage: tube eddy-current inspection and channel-head inspection.'],
  },
  {
    key: 'Control Valve', count: 10, tag: 'CV',
    specs: (r) => ([
      ['Type', pick(r, ['Globe, cage-guided', 'Rotary segmented ball', 'Butterfly (high-performance)'])],
      ['Size', `${pick(r, ['DN80', 'DN150', 'DN250', 'DN400'])}`],
      ['Actuator', pick(r, ['Pneumatic spring-diaphragm', 'Pneumatic piston', 'Electro-hydraulic'])],
    ]),
    limits: ['Positioner should track demand within a small deadband; investigate hysteresis growth.', 'Fail-safe action (open/close) must be verified after any actuator work.'],
    faults: [
      { symptom: 'Valve not tracking demand / high hysteresis (stiction)', causes: ['Packing over-tightened / galling', 'Positioner miscalibration', 'Actuator air-supply issue', 'Seat/plug wear'], steps: ['Run a step/ramp signature (valve travel vs demand) to quantify stiction.', 'Check instrument-air supply pressure and volume boosters.', 'Re-calibrate the positioner; relieve packing load if over-tightened.', 'Inspect trim for wear if seating is poor.'], tags: ['Vv Demand', 'Vv Feedback', 'Position'] },
      { symptom: 'Valve leaks by / cannot achieve tight shutoff', causes: ['Trim / seat erosion', 'Debris in seat', 'Actuator bench-set drift'], steps: ['Verify actuator bench set and seat load.', 'Inspect trim/seat for erosion or debris.', 'Confirm fail-safe seating force after re-assembly.'], tags: ['Position', 'Flow'] },
    ],
    pm: ['Quarterly: valve signature (stiction/deadband) test on critical loops.', 'Outage: trim inspection and packing service on high-cycle valves.'],
  },
  {
    key: 'Heat Exchanger', count: 6, tag: 'HX',
    specs: (r) => ([
      ['Type', pick(r, ['Shell-and-tube (BEM)', 'Plate-and-frame', 'Air-cooled (fin-fan)'])],
      ['Duty', `${range(r, 2, 60)} MWth`],
      ['Design fouling factor', `${range(r, 0.0001, 0.0006, 4)} m²K/W`],
    ]),
    limits: ['Track approach temperature and differential pressure as fouling indicators.', 'Respect tube-side/shell-side design pressures and temperatures.'],
    faults: [
      { symptom: 'Degrading performance / approach temperature rising', causes: ['Fouling / scaling', 'Air blanketing', 'Bypassing / partition leak'], steps: ['Trend approach temperature and dP together.', 'Vent non-condensables; verify flow distribution.', 'Plan cleaning when duty drops below threshold.'], tags: ['Approach Temp', 'dP'] },
      { symptom: 'Rising differential pressure', causes: ['Tube/plate fouling or debris', 'Partial blockage'], steps: ['Inspect strainers upstream for debris.', 'Backflush or schedule mechanical/chemical cleaning.'], tags: ['dP', 'Flow'] },
    ],
    pm: ['Monthly: approach temperature and dP trend.', 'Outage: cleaning and (shell-and-tube) eddy-current inspection.'],
  },
];

const PLANTS = ['Riverton', 'Ashford', 'Brookline', 'Cedar Falls', 'Glenmoor'];

function mdTable(rows) { return ['| Field | Value |', '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n'); }

function buildManual(cat, idx) {
  const r = rnd((cat.tag.charCodeAt(0) * 131 + idx * 977 + 7) | 0);
  const maker = pick(r, MAKERS);
  const series = String.fromCharCode(65 + Math.floor(r() * 6));
  const model = `${cat.tag}-${series}${range(r, 100, 990)}`;
  const id = `MAN-${cat.tag}-${String(idx + 1).padStart(3, '0')}`;
  const title = `${maker} ${cat.key} — Model ${model} Operation & Maintenance Manual`;
  const specs = cat.specs(r);

  const faultsMd = cat.faults.map((f, i) => {
    const causes = f.causes.map((c) => `- ${c}`).join('\n');
    const steps = f.steps.map((s, k) => `${k + 1}. ${s}`).join('\n');
    return `#### F${i + 1}. ${f.symptom}\n\n**Likely causes**\n${causes}\n\n**Recommended resolution**\n${steps}\n\n**Related tags/signals:** ${f.tags.join(', ')}`;
  }).join('\n\n');

  const body = [
    `# ${title}`,
    `\n**Document ID:** ${id}  \n**Manufacturer:** ${maker} (fictional)  \n**Model:** ${model}  \n**Equipment category:** ${cat.key}`,
    `\n> Synthetic reference manual generated for the OneGrid demonstration. It mimics the structure of a real O&M manual but contains no proprietary OEM content.`,
    `\n## 1. Overview\nThe ${cat.key.toLowerCase()} covered by this manual is a ${specs[0][1].toLowerCase()} unit intended for utility power-generation service. This manual covers safe operation, operating limits, startup and shutdown, troubleshooting, and preventive maintenance.`,
    `\n## 2. Specifications\n${mdTable(specs)}`,
    `\n## 3. Operating limits & protection\n${cat.limits.map((l) => `- ${l}`).join('\n')}`,
    `\n## 4. Startup (summary)\n1. Confirm auxiliaries, lube/seal systems, and instrumentation are in service.\n2. Verify all protection channels are healthy and permissives are met.\n3. Bring the unit up per the load/temperature ramp limits in Section 3.\n4. Monitor the key signals in Section 6 during loading.`,
    `\n## 5. Shutdown (summary)\n1. Reduce load per the allowed ramp; maintain minimum flows/limits.\n2. Sequence auxiliaries down per interlocks; keep lube/turning systems as required.\n3. Record final readings and any abnormal indications for the log.`,
    `\n## 6. Troubleshooting & work-order resolution\n${faultsMd}`,
    `\n## 7. Preventive maintenance\n${cat.pm.map((p) => `- ${p}`).join('\n')}`,
    `\n## 8. Safety\nFollow site lockout/tagout, confined-space, and hot-work procedures. Verify zero-energy state before intrusive work. Use the protection interlocks listed in Section 3; do not defeat trips without an approved procedure.`,
  ].join('\n');

  const plain = body.replace(/[#>*`|]/g, ' ').replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();

  return {
    id, title, manufacturer: maker, model,
    equipment_category: cat.key,
    applies_to_plants: PLANTS,
    fault_symptoms: cat.faults.map((f) => f.symptom),
    related_tags: [...new Set(cat.faults.flatMap((f) => f.tags))],
    body_markdown: body,
    body_text: plain,
  };
}

const manuals = [];
for (const cat of CATEGORIES) {
  for (let i = 0; i < cat.count; i++) manuals.push(buildManual(cat, i));
}

fs.writeFileSync(path.join(OUT, 'manuals.json'), JSON.stringify(manuals, null, 2), 'utf8');
const byCat = manuals.reduce((a, m) => ((a[m.equipment_category] = (a[m.equipment_category] || 0) + 1), a), {});
console.log(`Generated ${manuals.length} manuals ->`, path.join(OUT, 'manuals.json'));
console.log('By category:', JSON.stringify(byCat));
