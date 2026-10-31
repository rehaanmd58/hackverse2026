# Emergency Vehicle Corridor Simulation — Smart City Traffic Command Center

A high-performance, responsive municipal traffic command center dashboard simulating emergency preemption corridors for first responders. Features multi-intersection route clearance sequences, live safeguard logging, real-time ETA comparison KPIs, and 2D animated CSS traffic physics using pure Vanilla JavaScript, HTML5, and Tailwind CSS.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following requirements were confirmed during interactive clarification and will guide the simulation architecture:

- **Multi-Stage Corridor Visualization**: The 2D simulation will model the ambulance clearing through a progressive multi-intersection corridor (1 to 5 configurable intersections) with active stage tracking, dynamic signals, and pedestrian clearance phases.
- **Full Simulation Controls**: The live monitor includes complete playback controls (Play, Pause, Step, Replay, and 0.5x / 1x / 2x speed multipliers) allowing dispatchers to pause and analyze clearance sequences at each phase.
- **Emergency Alert Effects & Audio**: Visual emergency beacon flash pulses and an optional siren audio synthesis toggle (Web Audio API-driven so zero external audio assets are needed).
- **Zero-React Pure Vanilla JS Architecture**: Conforming strictly to the prompt specifications, the dashboard is built with pure HTML5, Tailwind CSS, and Vanilla JavaScript with modular DOM updates, avoiding React entirely.

---

## 1. Overview & Core Concept

- **What It Does**: Simulates urban traffic signal preemption (Green Wave / Emergency Vehicle Preemption - EVP). The system takes user dispatch parameters (traffic congestion level, corridor length from 1 to 5 intersections, and pedestrian clearance buffer) and calculates comparative arrival times while visually demonstrating the automated signal transition cycle (Green -> Yellow -> All-Red -> Preempted Green -> Restoration) on an interactive 2D top-down grid.
- **Target Audience & Persona**: Municipal traffic dispatchers, emergency logistics planners, and smart city civil engineers evaluating the real-world impact of automated corridor clearance.
- **Key Value**: Demonstrates the mathematical and temporal savings of automated corridor preemption over standard traffic delays, highlighting critical safeguards that prevent conflicting cross-traffic and protect pedestrians.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Portal 1: Dispatch & Configuration**:
   - Dispatch officer configures corridor parameters: Traffic Density (`Low`, `Medium`, `Heavy`), Intersections to Cross (`1` to `5`), and Pedestrian Clearance Buffer (`5` to `25` seconds).
   - Dynamic summary metrics update on the fly showing predicted clearance difficulty.
   - Prominent, high-contrast **"Dispatch Emergency Vehicle"** button initiates the preemption request.
   - A simulated network request (`POST /api/simulate`) triggers a brief dispatching telemetry sequence, then transitions seamlessly to Portal 2.

2. **Portal 2: Live Simulation & Analytics Monitor**:
   - **KPI Header**: 3 bold cards showing *Normal Traffic ETA*, *Emergency Corridor ETA*, and *Time Saved* with percentage efficiency gains and congestion offset calculations.
   - **Corridor Progress Ribbon**: Multi-node corridor track depicting current position among the 1 to 5 intersections.
   - **2D Intersection Simulation Arena**: Top-down CSS road grid with asphalt texturing, lane striping, pedestrian crosswalks with countdown timers, dynamic 4-way traffic light posts, and an animated ambulance with flashing red/blue strobe beacons and siren wavefronts. Cross-traffic vehicles queue up safely behind stop bars while the green corridor opens.
   - **Playback Deck**: Play/Pause, Replay Corridor, Step-by-Step Stage Advance, and Speed toggles (`0.5x`, `1x`, `2x`).
   - **Live Safeguard Event Log**: Terminal-style timestamped feed streaming safety-critical events (`Signal preemption locked`, `Cross-traffic yellow clearance initiated`, `Pedestrian walk signal terminated`, `All-red safety interval confirmed`, `Corridor clear - vehicle entering intersection`, `Normal cycle restored`).
   - **Sidebar Switcher**: Fast navigation back to Dispatch Configuration to run new scenarios with parameter retention.

3. **Footer & Compliance Area**:
   - Grounded mathematical assumptions (speeds, decelerations, detector ranges) and strict regulatory disclaimer: *"Theoretical simulation only. Does not interface with live traffic hardware."*

### Visual Identity & Theme

- **Aesthetic Direction**: Crisp, modern municipal traffic command center. Clean, high-legibility light theme inspired by air traffic and modern transit dispatch systems.
- **Color Palette & Distribution (60-30-10 Rule)**:
  - **60% Dominant Canvas**: `#F8FAFC` (Slate-50) and `#FFFFFF` crisp white card surfaces with subtle hairline borders (`#E2E8F0`).
  - **30% Structural Panels & Roadway**: `#0F172A` (asphalt roadway surface), `#334155` (curbs/markings), `#64748B` (secondary labels and grid lines).
  - **10% High-Intent Semantic Accents**:
    - Emergency Red (`#DC2626` / `#EF4444`) for ambulance markings and emergency priority locks.
    - Signal Amber (`#F59E0B`) for clearance intervals.
    - Signal Emerald (`#10B981`) for preempted green corridor rights-of-way.
    - Emergency Blue (`#2563EB` / `#3B82F6`) for secondary strobe flash and telematics.
- **Typography & Hierarchy**:
  - Display & Headings: `Plus Jakarta Sans` / `Outfit` font stack for bold authority and clean scannability.
  - Telemetry & KPI Numbers: Monospace tabular numerals (`font-mono tabular-nums`, `JetBrains Mono` / `ui-monospace`) to eliminate layout jitter during active countdowns.
  - Zero-Pill Discipline: Unboxed text with subtle typographic dot separators (`·`) for metadata; functional button-style segmented controls for interactive state toggles.

---

## 3. Key Product Decisions & Trade-Offs

- **Pure Vanilla JS vs React**:
  - *Decision*: Build with pure Vanilla JavaScript DOM manipulation and CSS animations in accordance with the explicit user requirement ("Do not use React. Use HTML5, Tailwind CSS, and Vanilla JavaScript").
  - *Why*: Delivers instantaneous frame rates for the CSS simulation loop, zero framework overhead, and direct exportability as an standalone web application.
- **Web Audio API Siren Synthesis vs External Sound Files**:
  - *Decision*: Synthesize the emergency siren frequency oscillation (`700Hz` to `1100Hz` frequency sweep) via the native browser `AudioContext` with an explicit dispatcher mute toggle.
  - *Why*: Eliminates dependencies on external MP3/WAV URLs that could fail in restricted sandboxes, ensuring 100% reliability with instantaneous response.
- **Progressive Multi-Stage Corridor Visualizer**:
  - *Decision*: Provide a central top-down 2D CSS intersection paired with an active corridor stage indicator and continuous traversal timeline across the chosen 1 to 5 intersections.
  - *Why*: Maintains high visual fidelity and fine detail on the road markings and traffic signals without shrinking the viewport, while clearly showing progression across the entire route.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MUNICIPAL COMMAND CENTER                        │
│                           (Single Page App)                            │
├──────────────────┬─────────────────────────────────────────────────────┤
│   SIDEBAR NAV    │                    PORTAL VIEWS                     │
│                  │                                                     │
│ ┌──────────────┐ │ ┌─────────────────────────────────────────────────┐ │
│ │  Dispatch &  │ │ │ Portal 1: Dispatch & Corridor Configuration     │ │
│ │  Config View │ │ │ - Congestion selector (Low / Med / Heavy)       │ │
│ ├──────────────┤ │ │ - Intersection count stepper (1 to 5)           │ │
│ │  Live Monitor│ │ │ - Pedestrian clearance buffer (s)               │ │
│ │  & Analytics │ │ │ - Dynamic travel time projection preview        │ │
│ └──────────────┘ │ │ - [Dispatch Emergency Vehicle] Action Button    │ │
│                  │ └─────────────────────────────────────────────────┘ │
│                  │                                                     │
│                  │ ┌─────────────────────────────────────────────────┐ │
│                  │ │ Portal 2: Live Simulation & Analytics Monitor   │ │
│                  │ │ ┌─────────────┬─────────────┬─────────────────┐ │ │
│                  │ │ │ Normal ETA  │ Preempt ETA │   Time Saved    │ │ │
│                  │ │ └─────────────┴─────────────┴─────────────────┘ │ │
│                  │ │ ┌───────────────────────────┬─────────────────┐ │ │
│                  │ │ │ 2D CSS Traffic Simulation │ Safeguard Log   │ │ │
│                  │ │ │ - Asphalt road grid       │ - Terminal feed │ │ │
│                  │ │ │ - 4-phase traffic lights  │ - Timestamped   │ │ │
│                  │ │ │ - Crosswalk indicators    │ - Clearance log │ │ │
│                  │ │ │ - Ambulance animation     │                 │ │ │
│                  │ │ │ - Play/Pause/Speed Deck   │                 │ │ │
│                  │ │ └───────────────────────────┴─────────────────┘ │ │
│                  │ └─────────────────────────────────────────────────┘ │
├──────────────────┴─────────────────────────────────────────────────────┤
│ FOOTER: Mathematical Assumptions & Live Hardware Disclaimer            │
└────────────────────────────────────────────────────────────────────────┘
```

### Simulation State Machine & Mathematical Formulas

1. **Travel Time Math**:
   - `Normal ETA = (Intersections * BaseTransitTime) + (TrafficDelayFactor * CongestionMultiplier * Intersections) + (AverageRedLightWait * Intersections)`
   - `Emergency ETA = (Intersections * EmergencyTransitTime) + (Intersections * ClearanceLeadTime)`
   - `Time Saved = Normal ETA - Emergency ETA` (typically 45% - 70% reduction).
2. **Corridor Clearance Sequence States**:
   - `APPROACH`: Vehicle enters detection zone (approx 500m out).
   - `PED_CLEAR`: Crosswalk turns to red hand; pedestrian countdown terminates safely.
   - `CROSS_YELLOW`: Conflicting traffic signal transitions green $\to$ yellow ($3\text{s}$).
   - `ALL_RED`: Conflicting cross traffic receives red; all-red safety buffer ($2\text{s}$) clears the intersection box.
   - `GREEN_CORRIDOR`: Ambulance corridor signal illuminates green; priority beacon activates.
   - `TRAVERSAL`: Vehicle speeds safely through intersection.
   - `RESTORE`: Signal gracefully transitions back to coordinated city timing plan.
