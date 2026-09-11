# OneGrid — Persona & Value Map

*A one-page guide to who benefits from the OneGrid demo across an oil, gas & energy organization — and how to pitch it to each.*

**What OneGrid is:** a Digital‑Twin + weather‑risk asset‑intelligence app on **Microsoft Fabric** (Eventhouse telemetry, Direct Lake / Import semantic model, Digital Twin Builder ontology) with an **Azure AI Foundry**–grounded Copilot. It stitches together the full decision chain — **executive KPIs → operational risk → equipment health → the wrench turn** — for a diverse estate (offshore platforms, wells, pipelines, LNG, terminals, refineries, thermal power plants).

---

## The one-line pitch

> *"One governed platform that tells your CIO the fleet is exposed, tells your reliability engineer which bearing is failing, and tells your technician which manual to open — from the same data."*

---

## Persona → value map

### 1. C‑suite / Executive — the "why this matters" story
| Role | Screen that lands | Value narrative |
|---|---|---|
| **CIO / CTO** | Whole stack: Fabric → Direct Lake → 3D app + Copilot, one‑click deploy | Consolidate historian + weather + work management + AI on one governed platform — no integration sprawl. |
| **CDO / Head of Data & Analytics** | Eventhouse, semantic model, ontology, lineage | Real medallion/lakehouse data‑product + governance pattern. |
| **COO** | Command Center fleet view + Response Posture + storm exposure | Single pane: "how exposed is my fleet, and are we ready?" |
| **Chief Risk / Resilience Officer** | Hurricane track, cone, wind fields, asset risk + lead‑time | Quantified climate / physical‑risk to operations and capital. |
| **CFO / Insurance & Risk Finance** | $ assets‑at‑risk, outage history, predicted trips | Loss avoidance, downtime cost, parametric‑insurance framing. |
| **Chief HSE / Sustainability** | Storm preparedness, shutdown lead‑time, critical‑asset flags | Safety‑critical protection; evacuation / curtailment decisions. |

### 2. Digital / IT leadership — the buyers & builders
| Role | Demo hook | Value |
|---|---|---|
| **VP Digital / Transformation** | "Accelerator you clone and deploy" | Fast time‑to‑value blueprint for OT/IT convergence. |
| **Enterprise / Solution Architect** | Fabric + Foundry reference architecture, managed identity, RBAC | Reusable, secure pattern. |
| **Head of Cloud / Platform** | App Service + managed identity + Fabric capacity | Ops model, cost, scaling. |

### 3. Operations leadership — the daily owners
| Role | Demo hook | Value |
|---|---|---|
| **VP Operations / Asset Management** | Fleet health + exposure + posture across the estate | Prioritize across a diverse portfolio. |
| **Plant / Facility / Asset Manager** | Site → Unit → Equipment drill‑down, per‑site risk | "What in *my* plant is critical this week?" |
| **Operations / Production Manager** | Predicted trips, RUL, curtailment planning | Protect production; plan around weather windows. |

### 4. Reliability & Maintenance engineering — the deepest, most credible fit
| Role | Demo hook | Value |
|---|---|---|
| **Reliability Engineer** | Digital‑twin hotspots, survival curves, anomaly advisories (peak‑z), AAKR health, root cause | Condition‑based / predictive maintenance in one view. |
| **Rotating‑Equipment / Condition‑Monitoring Eng.** | 3D equipment twins with per‑zone live readings (bearings, casings, seals) | Vibration/temperature diagnostics tied to geometry. |
| **Maintenance Manager** | Open work orders, WO summary, predicted failures | Backlog prioritization by risk + weather. |
| **Maintenance Planner / Scheduler** | Lead‑time to impact + "next weather window" recommendation | Schedule inspections/turnarounds intelligently. |

### 5. Control room & emergency response — the "live ops" fit
| Role | Demo hook | Value |
|---|---|---|
| **Control Room Operator (Digital Twin Control Room)** | Live alert stream → click to open 3D diagnostic | Real‑time situational awareness. |
| **Emergency Mgmt / Business Continuity / Storm Desk** | Storm selector, cone, posture, lead‑time countdown | Ride‑out vs shutdown decisions; resource staging. |
| **Dispatcher / Ops Center** | Asset map with all active storms + risk gradient | Coordinate crews and curtailment. |

### 6. Frontline / field — the "wrench turn" fit
| Role | Demo hook | Value |
|---|---|---|
| **Maintenance Technician / Mechanic** | Recommended action + **"Click here for the Manual"** (Foundry IQ) | Guided fix; right procedure at the asset. |
| **Field / Wellsite / Platform Operator** | Asset health colors, exposure flags | Know what to watch/secure before a storm. |
| **Turnaround / Outage Coordinator** | Outage history + predicted trips + work orders | Plan shutdowns and scope. |

### Cross‑cutting — the Copilot / "Ask Data" persona
The grounded chat (weather + exposure + outages + work orders, with a **persona selector**) is the great equalizer:
- **Exec:** *"Which assets are most at risk in the next 72 hours?"*
- **Planner:** *"What's my open backlog on Thunder Horse?"*
- **Technician:** *"What's wrong with RV3 and how do I fix it?"*

Same data, role‑appropriate answer. Demoing the persona switch shows one platform serving all six tiers.

---

## Demo script by audience (2–3 minutes each)

**Executives** — Open on the **Command Center 3D map with a hurricane bearing down** → "$X of critical assets, Y hours to impact." Emotional + quantified. Close with the one‑click deploy / one‑platform message.

**Reliability & Maintenance** — Go to **Asset Explorer → a Steam Turbine → open the 3D twin**. Show per‑zone readings (HP casing, IP section, LP exhaust, bearings, rotor), the **survival curve + RUL**, **root cause**, then the **"open the manual"** link. This is a day‑job tool, not eye candy.

**Control room / Emergency** — Show the **live alert stream → click an alert → 3D diagnostic**, then flip to **Risk** (storm selector) and **Response Posture** with the lead‑time countdown. This is the "operational nervous system."

**Field / Frontline** — Keep it to **health color → recommended action → manual**. Anything more is noise at the asset.

**IT / Data** — Walk the **Fabric workspace** (Eventhouse, semantic model, ontology) and the **deploy wizard**; emphasize managed identity, governance, and "no bespoke integrations."

---

## Feature → screen reference
| Capability | Where in the app |
|---|---|
| Fleet overview + 3D holographic map | Command Center (`/webapp/app`) |
| Site→Unit→Equipment hierarchy + 3D twins | Asset Explorer (`/webapp/app/asset-explorer`) |
| Live telemetry + alert stream | Digital Twin Control Room (`/webapp/app/control-room`) |
| Storm track / cone / wind / asset risk | Risk (`/webapp/app/risk`) |
| Readiness & shutdown lead‑time | Response Posture (`/webapp/app/posture`) |
| Survival / RUL / root cause / forecast | Simulation |
| Work orders + equipment manuals | Maintenance (`/webapp/app/maintenance`) |
| Grounded Q&A with personas | OneGrid Copilot dock (all pages) |

---

*Audience: sales, pre‑sales, and demo enablement. Pair with a live deployment for maximum impact.*
