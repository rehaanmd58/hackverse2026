/**
 * Municipal Traffic SCADA Control Dashboard
 * Advanced Traffic Management System (ATMS)
 * Vanilla TypeScript Controller
 */

import * as d3 from 'd3';

// ============================================================================
// Types & Interfaces
// ============================================================================

type TrafficDensity = 'Low' | 'Medium' | 'Heavy';

interface CorridorConfig {
  density: TrafficDensity;
  intersections: number;
  pedClearanceTime: number; // in seconds
}

interface NodeTelemetry {
  id: string; // 'Node A', 'Node B', etc.
  name: string;
  ip: string;
  signalState: 'GREEN' | 'YELLOW' | 'RED';
  preemptLock: 'ACTIVE' | 'STANDBY' | 'CLEARED' | 'ARMED';
  detectorLatency: number; // ms
  queueCount: number;
  queueStatus: string;
  interlock: 'SECURED' | 'PENDING' | 'REVERTED';
}

interface SCADASimulationState {
  currentStageIndex: number; // 0 to config.intersections - 1
  totalStages: number;
  phaseIndex: number; // 0: approach, 1: ped-clear, 2: yellow, 3: all-red, 4: green-corridor, 5: restore
  progress: number; // 0.0 to 1.0 within stage
  isRunning: boolean;
  isPaused: boolean;
  speedMultiplier: number;
  normalEtaSeconds: number;
  corridorEtaSeconds: number;
  timeSavedSeconds: number;
  percentSaved: number;
  logCount: number;
}

interface LogRecord {
  frameId: number;
  timestampIso: string;
  tag: string;
  activeNode: string;
  phaseInterval: string;
  message: string;
}

interface CivilianVehicle {
  id: string;
  lane: 'southbound' | 'northbound';
  y: number; // in pixels relative to viewport center
  speed: number; // px per second
  stopY: number; // target queue position in pixels
  isBraking: boolean;
  isStopped: boolean;
}

const CORRIDOR_NODES_DATA = [
  { id: 'Node A', name: 'Maple Ave & 4th St', ip: '192.168.1.101', split: 45 },
  { id: 'Node B', name: 'Grand Blvd & Oak St', ip: '192.168.1.102', split: 40 },
  { id: 'Node C', name: 'Civic Center Pkwy & Pine', ip: '192.168.1.103', split: 50 },
  { id: 'Node D', name: 'Market St & 8th Ave', ip: '192.168.1.104', split: 38 },
  { id: 'Node E', name: 'Metro Pkwy & University', ip: '192.168.1.105', split: 48 }
];

// ============================================================================
// SCADA Control Dashboard Engine
// ============================================================================

class SCADACommandCenter {
  private config: CorridorConfig = {
    density: 'Medium',
    intersections: 3,
    pedClearanceTime: 12
  };

  private state: SCADASimulationState = {
    currentStageIndex: 0,
    totalStages: 3,
    phaseIndex: 0,
    progress: 0,
    isRunning: false,
    isPaused: false,
    speedMultiplier: 1.0,
    normalEtaSeconds: 450,
    corridorEtaSeconds: 135,
    timeSavedSeconds: 315,
    percentSaved: 70,
    logCount: 0
  };

  private nodes: NodeTelemetry[] = [];
  private logRecords: LogRecord[] = [];
  private animationFrameId: number | null = null;
  private lastTimestamp: number = 0;
  private jitterTimer: number | null = null;

  // Civilian Cross-Traffic Simulation Vehicles
  private civilianCars: CivilianVehicle[] = [
    // Southbound (moving downward from top to bottom, stop line at -56px, car height 36px)
    { id: 'civ-car-s1', lane: 'southbound', y: -92, speed: 85, stopY: -92, isBraking: false, isStopped: false },
    { id: 'civ-car-s2', lane: 'southbound', y: -138, speed: 85, stopY: -138, isBraking: false, isStopped: false },
    { id: 'civ-car-s3', lane: 'southbound', y: -184, speed: 85, stopY: -184, isBraking: false, isStopped: false },

    // Northbound (moving upward from bottom to top, stop line at +56px, car height 36px)
    { id: 'civ-car-n1', lane: 'northbound', y: 56, speed: 85, stopY: 56, isBraking: false, isStopped: false },
    { id: 'civ-car-n2', lane: 'northbound', y: 102, speed: 85, stopY: 102, isBraking: false, isStopped: false },
    { id: 'civ-car-n3', lane: 'northbound', y: 148, speed: 85, stopY: 148, isBraking: false, isStopped: false }
  ];

  // Cached DOM Elements
  private elements: Record<string, HTMLElement | null> = {};

  constructor() {
    this.cacheDomElements();
    this.initNodes();
    this.bindEvents();
    this.startUtcClock();
    this.recalculateProjections();
    this.renderTopologyMatrix();
    this.initTerminalTelemetry();
    this.startLatencyJitter();
    this.renderTelemetryFrame(0);
    this.switchPortal(0); // Default to welcoming Home / Overview view
  }

  private cacheDomElements() {
    const ids = [
      'app-sidebar', 'btn-toggle-sidebar', 'btn-header-home',
      'nav-portal-0', 'nav-portal-1', 'nav-portal-2', 'nav-portal-3',
      'portal-view-home', 'portal-view-dispatch', 'portal-view-monitor', 'portal-view-impact',
      'btn-hero-launch-dispatch', 'btn-hero-view-monitor', 'btn-home-learn-impact',
      'btn-impact-launch-dispatch', 'scada-utc-clock', 'scada-system-state', 'btn-header-quick-dispatch',
      'sidebar-density-badge', 'sidebar-intersections-badge', 'sidebar-ped-badge', 'sidebar-time-saved',
      'btn-sidebar-reset',
      'input-density', 'input-intersections', 'intersections-count-label',
      'btn-decrease-intersections', 'btn-increase-intersections',
      'input-ped-time', 'ped-time-label', 'btn-dispatch-vehicle',
      'dispatch-spinner', 'dispatch-icon', 'dispatch-btn-text',
      'preview-normal-eta', 'preview-corridor-eta', 'preview-time-saved',
      'preview-distance-str', 'kpi-percent-saved', 'kpi-time-saved',
      'kpi-corridor-eta', 'kpi-normal-eta', 'scada-status-indicator',
      'scada-state-label', 'scada-active-node-name', 'scada-phase-badge',
      'btn-sim-play-pause', 'label-play-pause', 'btn-sim-step', 'btn-sim-replay',
      'btn-export-telemetry', 'export-telemetry-label', 'btn-terminal-export',
      'topology-summary', 'topology-pipeline-container', 'topology-map-svg', 'node-matrix-tbody',
      'active-ring-barrier', 'timer-green-ext', 'status-green-ext',
      'timer-yellow-change', 'status-yellow-change', 'timer-all-red',
      'status-all-red', 'timer-ped-clearance', 'status-ped-clearance',
      'phase-row-2-state', 'phase-row-4-state', 'phase-row-6-state',
      'safeguard-terminal-log', 'log-count-badge', 'btn-clear-log', 'terminal-scroll-status',
      // 2D LiDAR Top-Down Simulation Map Elements
      'lidar-hud-junction-name', 'lidar-hud-distance', 'lidar-hud-wave-status',
      'lidar-hud-time-remaining', 'lidar-hud-safety-clearance', 'lidar-emergency-vehicle',
      'beacon-strobe-red', 'beacon-strobe-blue',
      'sig-west-red', 'sig-west-yellow', 'sig-west-green',
      'sig-east-red', 'sig-east-yellow', 'sig-east-green',
      'sig-north-red', 'sig-north-yellow', 'sig-north-green',
      'lidar-ped-sign-north', 'lidar-ped-sign-south',
      'lidar-sensor-loop-pulse', 'lidar-hud-cross-traffic',
      'civ-car-s1', 'civ-car-s2', 'civ-car-s3',
      'civ-car-n1', 'civ-car-n2', 'civ-car-n3'
    ];

    ids.forEach(id => {
      this.elements[id] = document.getElementById(id);
    });
  }

  private initNodes() {
    this.nodes = CORRIDOR_NODES_DATA.slice(0, this.config.intersections).map((d, idx) => ({
      id: d.id,
      name: d.name,
      ip: d.ip,
      signalState: idx === 0 ? 'YELLOW' : 'RED',
      preemptLock: idx === 0 ? 'ARMED' : 'STANDBY',
      detectorLatency: 14 + Math.floor(Math.random() * 5),
      queueCount: idx === 0 ? 3 : 2,
      queueStatus: 'Holding',
      interlock: 'SECURED'
    }));
  }

  // ==========================================================================
  // Event Bindings
  // ==========================================================================

  private bindEvents() {
    // Sidebar collapse toggle
    this.elements['btn-toggle-sidebar']?.addEventListener('click', () => {
      const sidebar = this.elements['app-sidebar'];
      if (sidebar) sidebar.classList.toggle('sidebar-collapsed');
      setTimeout(() => this.renderD3MapOverlay(), 320);
    });

    window.addEventListener('resize', () => {
      this.renderD3MapOverlay();
    });

    // Navigation item switches
    this.elements['nav-portal-0']?.addEventListener('click', () => this.switchPortal(0));
    this.elements['nav-portal-1']?.addEventListener('click', () => this.switchPortal(1));
    this.elements['nav-portal-2']?.addEventListener('click', () => this.switchPortal(2));
    this.elements['nav-portal-3']?.addEventListener('click', () => this.switchPortal(3));

    // Home / Hero buttons
    this.elements['btn-header-home']?.addEventListener('click', () => this.switchPortal(0));
    this.elements['btn-hero-launch-dispatch']?.addEventListener('click', () => this.switchPortal(1));
    this.elements['btn-hero-view-monitor']?.addEventListener('click', () => this.switchPortal(2));
    this.elements['btn-home-learn-impact']?.addEventListener('click', () => this.switchPortal(3));

    document.querySelectorAll('.btn-goto-dispatch').forEach(btn => {
      btn.addEventListener('click', () => this.switchPortal(1));
    });
    document.querySelectorAll('.btn-goto-impact').forEach(btn => {
      btn.addEventListener('click', () => this.switchPortal(3));
    });
    document.querySelectorAll('.btn-goto-monitor').forEach(btn => {
      btn.addEventListener('click', () => this.switchPortal(2));
    });

    this.elements['btn-impact-launch-dispatch']?.addEventListener('click', () => this.switchPortal(1));

    this.elements['btn-header-quick-dispatch']?.addEventListener('click', () => {
      this.switchPortal(1);
      this.handleDispatchCommand();
    });

    this.elements['btn-sidebar-reset']?.addEventListener('click', () => this.resetDefaults());

    // Congestion density select
    const densitySelect = this.elements['input-density'] as HTMLSelectElement | null;
    if (densitySelect) {
      densitySelect.addEventListener('change', (e) => {
        this.config.density = (e.target as HTMLSelectElement).value as TrafficDensity;
        this.recalculateProjections();
      });
    }

    // Intersections range slider & buttons
    const intersectionsSlider = this.elements['input-intersections'] as HTMLInputElement | null;
    if (intersectionsSlider) {
      intersectionsSlider.addEventListener('input', (e) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        this.setIntersections(val);
      });
    }

    this.elements['btn-decrease-intersections']?.addEventListener('click', () => {
      this.setIntersections(Math.max(1, this.config.intersections - 1));
    });

    this.elements['btn-increase-intersections']?.addEventListener('click', () => {
      this.setIntersections(Math.min(5, this.config.intersections + 1));
    });

    // Pedestrian clearance input
    const pedTimeInput = this.elements['input-ped-time'] as HTMLInputElement | null;
    if (pedTimeInput) {
      pedTimeInput.addEventListener('input', (e) => {
        let val = parseInt((e.target as HTMLInputElement).value, 10);
        if (isNaN(val)) val = 12;
        val = Math.max(5, Math.min(25, val));
        this.config.pedClearanceTime = val;
        if (this.elements['ped-time-label']) {
          this.elements['ped-time-label'].textContent = `${val}.0s`;
        }
        this.recalculateProjections();
      });
    }

    // Pedestrian presets
    document.querySelectorAll('.btn-ped-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const val = parseInt(target.getAttribute('data-val') || '12', 10);
        this.config.pedClearanceTime = val;
        if (pedTimeInput) pedTimeInput.value = val.toString();
        if (this.elements['ped-time-label']) {
          this.elements['ped-time-label'].textContent = `${val}.0s`;
        }
        document.querySelectorAll('.btn-ped-preset').forEach(b => b.classList.remove('bg-slate-100', 'font-bold'));
        target.classList.add('bg-slate-100', 'font-bold');
        this.recalculateProjections();
      });
    });

    // Dispatch Command Button
    this.elements['btn-dispatch-vehicle']?.addEventListener('click', () => this.handleDispatchCommand());

    // SCADA Operator Controls
    this.elements['btn-sim-play-pause']?.addEventListener('click', () => this.togglePlayPause());
    this.elements['btn-sim-step']?.addEventListener('click', () => this.stepSimulation());
    this.elements['btn-sim-replay']?.addEventListener('click', () => this.restartSimulation());

    // Speed multipliers
    document.querySelectorAll('.btn-speed').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const speed = parseFloat(target.getAttribute('data-speed') || '1.0');
        this.state.speedMultiplier = speed;
        document.querySelectorAll('.btn-speed').forEach(b => {
          b.classList.remove('bg-white', 'text-slate-900', 'font-bold', 'shadow-2xs');
          b.classList.add('text-slate-600');
        });
        target.classList.add('bg-white', 'text-slate-900', 'font-bold', 'shadow-2xs');
        target.classList.remove('text-slate-600');
        this.addLog('SCADA-CONFIG', `Telemetry loop sample interval adjusted to ${speed}x rate.`);
      });
    });

    // Export Telemetry (CSV) Handlers
    this.elements['btn-export-telemetry']?.addEventListener('click', () => this.exportTelemetryCsv());
    this.elements['btn-terminal-export']?.addEventListener('click', () => this.exportTelemetryCsv());

    // Clear Terminal Log
    this.elements['btn-clear-log']?.addEventListener('click', () => {
      const terminal = this.elements['safeguard-terminal-log'];
      if (terminal) terminal.innerHTML = '';
      this.state.logCount = 0;
      this.logRecords = [];
      if (this.elements['log-count-badge']) {
        this.elements['log-count-badge'].textContent = '0 Frames';
      }
    });
  }

  private setIntersections(val: number) {
    this.config.intersections = val;
    const slider = this.elements['input-intersections'] as HTMLInputElement | null;
    if (slider) slider.value = val.toString();
    const letters = ['A', 'B', 'C', 'D', 'E'].slice(0, val).join(', ');
    if (this.elements['intersections-count-label']) {
      this.elements['intersections-count-label'].textContent = `${val} Node${val > 1 ? 's' : ''} Selected (${letters})`;
    }
    this.initNodes();
    this.recalculateProjections();
    this.renderTopologyMatrix();
  }

  private resetDefaults() {
    this.config = {
      density: 'Medium',
      intersections: 3,
      pedClearanceTime: 12
    };

    const densitySelect = this.elements['input-density'] as HTMLSelectElement | null;
    if (densitySelect) densitySelect.value = 'Medium';

    const pedTimeInput = this.elements['input-ped-time'] as HTMLInputElement | null;
    if (pedTimeInput) pedTimeInput.value = '12';

    this.setIntersections(3);
    this.addLog('SYSTEM-RESET', 'Signal synchronization baseline settings restored.');
  }

  // ==========================================================================
  // UTC Clock & Telemetry Jitter
  // ==========================================================================

  private startUtcClock() {
    const updateTime = () => {
      const now = new Date();
      const utc = now.toISOString().replace('T', ' ').replace('Z', ' UTC');
      const timePart = utc.split(' ')[1];
      if (this.elements['scada-utc-clock']) {
        this.elements['scada-utc-clock'].textContent = timePart;
      }
    };
    updateTime();
    setInterval(updateTime, 100);
  }

  private startLatencyJitter() {
    this.jitterTimer = window.setInterval(() => {
      this.nodes.forEach(n => {
        n.detectorLatency = Math.max(9, Math.min(24, n.detectorLatency + (Math.random() > 0.5 ? 1 : -1)));
      });
      this.updateTelemetryTableOnly();
    }, 1500);
  }

  private switchPortal(portalId: 0 | 1 | 2 | 3) {
    const p0 = this.elements['portal-view-home'];
    const p1 = this.elements['portal-view-dispatch'];
    const p2 = this.elements['portal-view-monitor'];
    const p3 = this.elements['portal-view-impact'];

    const navButtons = [
      this.elements['nav-portal-0'],
      this.elements['nav-portal-1'],
      this.elements['nav-portal-2'],
      this.elements['nav-portal-3']
    ];

    const activeNavClass = 'sidebar-item-btn w-full flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-500/30 transition-all cursor-pointer text-left';
    const inactiveNavClass = 'sidebar-item-btn w-full flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-all cursor-pointer text-left';

    if (p0) p0.classList.add('hidden');
    if (p1) p1.classList.add('hidden');
    if (p2) p2.classList.add('hidden');
    if (p3) p3.classList.add('hidden');

    navButtons.forEach((btn, idx) => {
      if (!btn) return;
      const isActive = idx === portalId;
      btn.className = isActive ? activeNavClass : inactiveNavClass;
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.setAttribute('class', `w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`);
      }
      const subSpan = btn.querySelector('.sidebar-text-label span:nth-child(2)');
      if (subSpan) {
        subSpan.className = `text-[10px] font-normal ${isActive ? 'text-blue-100' : 'text-slate-500'}`;
      }
    });

    if (portalId === 0 && p0) p0.classList.remove('hidden');
    if (portalId === 1 && p1) p1.classList.remove('hidden');
    if (portalId === 2) {
      if (p2) p2.classList.remove('hidden');
      this.renderTopologyMatrix();
    }
    if (portalId === 3 && p3) p3.classList.remove('hidden');
  }

  // ==========================================================================
  // Kinematic Calculations & KPI Ribbon
  // ==========================================================================

  private recalculateProjections() {
    const count = this.config.intersections;
    const density = this.config.density;
    const pedBuffer = this.config.pedClearanceTime;

    let normalSpeedMph = 18;
    let delayPerIntersectionSec = 50;

    if (density === 'Low') {
      normalSpeedMph = 25;
      delayPerIntersectionSec = 30;
    } else if (density === 'Heavy') {
      normalSpeedMph = 11;
      delayPerIntersectionSec = 75;
    }

    const distanceMiles = count * 0.28;
    const normalTransitSeconds = (distanceMiles / normalSpeedMph) * 3600;
    const normalWaitSeconds = count * delayPerIntersectionSec + (count * pedBuffer * 0.4);
    const totalNormalSeconds = Math.round(normalTransitSeconds + normalWaitSeconds);

    const emergencySpeedMph = 38.0;
    const emergencyTransitSeconds = (distanceMiles / emergencySpeedMph) * 3600;
    const emergencySafetyHoldSeconds = count * 4.5;
    const totalEmergencySeconds = Math.round(emergencyTransitSeconds + emergencySafetyHoldSeconds);

    const timeSavedSeconds = Math.max(0, totalNormalSeconds - totalEmergencySeconds);
    const percentSaved = Math.round((timeSavedSeconds / totalNormalSeconds) * 100);

    this.state.normalEtaSeconds = totalNormalSeconds;
    this.state.corridorEtaSeconds = totalEmergencySeconds;
    this.state.timeSavedSeconds = timeSavedSeconds;
    this.state.percentSaved = percentSaved;

    const normalStr = this.formatDuration(totalNormalSeconds);
    const corridorStr = this.formatDuration(totalEmergencySeconds);
    const savedStr = this.formatDuration(timeSavedSeconds);

    // Update Portal 1 Previews
    if (this.elements['preview-normal-eta']) this.elements['preview-normal-eta'].textContent = normalStr;
    if (this.elements['preview-corridor-eta']) this.elements['preview-corridor-eta'].textContent = corridorStr;
    if (this.elements['preview-time-saved']) {
      this.elements['preview-time-saved'].textContent = `${savedStr} (-${percentSaved}%)`;
    }
    if (this.elements['preview-distance-str']) {
      this.elements['preview-distance-str'].textContent = `${distanceMiles.toFixed(2)} mi (${count} Intersections)`;
    }

    // Sidebar
    if (this.elements['sidebar-density-badge']) this.elements['sidebar-density-badge'].textContent = density;
    if (this.elements['sidebar-intersections-badge']) {
      this.elements['sidebar-intersections-badge'].textContent = `${count} Nodes`;
    }
    if (this.elements['sidebar-ped-badge']) {
      this.elements['sidebar-ped-badge'].textContent = `${pedBuffer}.0s`;
    }
    if (this.elements['sidebar-time-saved']) {
      this.elements['sidebar-time-saved'].textContent = `-${percentSaved}% (${savedStr})`;
    }

    // Portal 2 KPI Ribbon
    if (this.elements['kpi-percent-saved']) this.elements['kpi-percent-saved'].textContent = `-${percentSaved}%`;
    if (this.elements['kpi-time-saved']) this.elements['kpi-time-saved'].textContent = savedStr;
    if (this.elements['kpi-corridor-eta']) this.elements['kpi-corridor-eta'].textContent = corridorStr;
    if (this.elements['kpi-normal-eta']) this.elements['kpi-normal-eta'].textContent = normalStr;
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  }

  // ==========================================================================
  // Dispatch Request (POST /api/simulate)
  // ==========================================================================

  private async handleDispatchCommand() {
    const btn = this.elements['btn-dispatch-vehicle'] as HTMLButtonElement | null;
    const spinner = this.elements['dispatch-spinner'];
    const icon = this.elements['dispatch-icon'];
    const btnText = this.elements['dispatch-btn-text'];

    if (!btn) return;

    btn.disabled = true;
    spinner?.classList.remove('hidden');
    icon?.classList.add('hidden');
    if (btnText) btnText.textContent = 'TRANSMITTING NEMA TS2 PREEMPT COMMAND...';

    const payload = {
      command: 'ACTIVATE_PREEMPTION_CORRIDOR',
      protocol: 'NEMA_TS2_TYPE_1_SDLC',
      density: this.config.density,
      nodes: this.nodes.map(n => ({ id: n.id, ip: n.ip })),
      pedClearanceSec: this.config.pedClearanceTime,
      timestamp: new Date().toISOString()
    };

    this.addLog('NEMA-BROADCAST', `Initiating POST /api/simulate -> Broadcasting Frame 0x1F Preempt Call to ${this.config.intersections} nodes.`);

    try {
      await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch {}

    await new Promise(resolve => setTimeout(resolve, 400));

    btn.disabled = false;
    spinner?.classList.add('hidden');
    icon?.classList.remove('hidden');
    if (btnText) btnText.textContent = 'DISPATCH EMERGENCY VEHICLE';

    this.switchPortal(2);
    this.startSimulation();
  }

  // ==========================================================================
  // Corridor Node Topology Matrix Rendering
  // ==========================================================================

  private renderTopologyMatrix() {
    // 1. Pipeline Bus Visualization
    const pipeline = this.elements['topology-pipeline-container'];
    if (pipeline) {
      pipeline.innerHTML = '';
      this.nodes.forEach((node, idx) => {
        const isCurrent = idx === this.state.currentStageIndex;
        const isPast = idx < this.state.currentStageIndex;

        const nodeBox = document.createElement('div');
        nodeBox.className = `node-box-item flex flex-col items-center z-10 transition-all ${
          isCurrent ? 'scale-105' : ''
        }`;

        let statusBg = 'bg-white/95 text-slate-700 border-slate-300/90 shadow-sm';
        let statusDot = 'bg-slate-400';
        let statusText = 'STANDBY';

        if (isCurrent) {
          statusBg = 'bg-red-50/95 text-red-900 border-red-400 ring-1 ring-red-400/80 shadow-md';
          statusDot = 'bg-red-600 animate-pulse';
          statusText = 'PREEMPT';
        } else if (isPast) {
          statusBg = 'bg-emerald-50/95 text-emerald-900 border-emerald-300 shadow-sm';
          statusDot = 'bg-emerald-600';
          statusText = 'CLEARED';
        }

        nodeBox.innerHTML = `
          <div class="w-24 p-2 rounded-xl border text-center backdrop-blur-xs ${statusBg}">
            <div class="flex items-center justify-between text-[10px] font-bold font-mono">
              <span>${node.id}</span>
              <span class="w-1.5 h-1.5 rounded-full ${statusDot}"></span>
            </div>
            <div class="text-[9px] text-slate-500 truncate mt-0.5">${node.name.split('&')[0]}</div>
            <div class="text-[9px] font-bold mt-1 tracking-tight font-mono">${statusText}</div>
          </div>
        `;

        pipeline.appendChild(nodeBox);
      });
    }

    // 2. Render Subtle D3.js SVG Street Map Overlay behind nodes
    requestAnimationFrame(() => {
      this.renderD3MapOverlay();
    });

    // 3. Dense Telemetry Table
    this.updateTelemetryTableOnly();
  }

  // ==========================================================================
  // Subtle D3.js City Street Map Overlay (Muted Slate-700 Street Network)
  // ==========================================================================

  private renderD3MapOverlay() {
    const svgEl = this.elements['topology-map-svg'] as SVGSVGElement | null;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const rect = svgEl.getBoundingClientRect();
    const width = Math.max(280, rect.width || 680);
    const height = Math.max(140, rect.height || 170);

    svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', '100%');

    // Defs: Glow filters
    const defs = svg.append('defs');

    const glow = defs.append('filter')
      .attr('id', 'corridor-glow')
      .attr('x', '-20%')
      .attr('y', '-20%')
      .attr('width', '140%')
      .attr('height', '140%');
    glow.append('feGaussianBlur').attr('stdDeviation', '2').attr('result', 'blur');
    glow.append('feMerge').selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic'])
      .enter()
      .append('feMergeNode')
      .attr('in', d => d);

    // City street grid group
    const mapGroup = svg.append('g').attr('class', 'city-grid');

    // Horizontal Avenues: thin muted slate-700 lines
    const arterialY = height * 0.52;
    const northAvenueY = height * 0.18;
    const southAvenueY = height * 0.86;

    // Draw secondary east-west avenues
    [northAvenueY, southAvenueY].forEach((y, i) => {
      // Avenue curb lines (thin muted slate-700)
      mapGroup.append('line')
        .attr('x1', 0)
        .attr('y1', y - 5)
        .attr('x2', width)
        .attr('y2', y - 5)
        .attr('stroke', '#334155')
        .attr('stroke-width', 0.75)
        .attr('stroke-opacity', 0.35);

      mapGroup.append('line')
        .attr('x1', 0)
        .attr('y1', y + 5)
        .attr('x2', width)
        .attr('y2', y + 5)
        .attr('stroke', '#334155')
        .attr('stroke-width', 0.75)
        .attr('stroke-opacity', 0.35);

      // Center dashed line
      mapGroup.append('line')
        .attr('x1', 0)
        .attr('y1', y)
        .attr('x2', width)
        .attr('y2', y)
        .attr('stroke', '#334155')
        .attr('stroke-width', 0.75)
        .attr('stroke-dasharray', '4,4')
        .attr('stroke-opacity', 0.25);

      // Avenue name label
      mapGroup.append('text')
        .attr('x', 10)
        .attr('y', y - 7)
        .attr('font-size', '7px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('fill', '#475569')
        .attr('opacity', 0.65)
        .text(i === 0 ? 'NORTH ARTERIAL // 4TH AVE' : 'SOUTH EXPRESS // CIVIC BLVD');
    });

    // Node Positions calculation relative to SVG
    const pipelineContainer = this.elements['topology-pipeline-container'];
    const nodeBoxes = pipelineContainer?.querySelectorAll('.node-box-item');
    const containerRect = svgEl.getBoundingClientRect();

    const nodePoints: { x: number; y: number; node: NodeTelemetry; idx: number }[] = [];

    if (nodeBoxes && nodeBoxes.length === this.nodes.length && containerRect.width > 0) {
      nodeBoxes.forEach((el, idx) => {
        const r = el.getBoundingClientRect();
        const cx = (r.left - containerRect.left) + r.width / 2;
        const cy = (r.top - containerRect.top) + r.height / 2;
        nodePoints.push({
          x: Math.max(30, Math.min(width - 30, cx)),
          y: cy || arterialY,
          node: this.nodes[idx],
          idx
        });
      });
    } else {
      const step = width / (this.nodes.length + 1);
      this.nodes.forEach((node, idx) => {
        nodePoints.push({
          x: (idx + 1) * step,
          y: arterialY,
          node,
          idx
        });
      });
    }

    // Cross Streets (vertical muted slate-700 grid lines through each intersection)
    nodePoints.forEach((pt) => {
      // Cross street curb lines
      mapGroup.append('line')
        .attr('x1', pt.x - 14)
        .attr('y1', 0)
        .attr('x2', pt.x - 14)
        .attr('y2', height)
        .attr('stroke', '#334155')
        .attr('stroke-width', 0.8)
        .attr('stroke-opacity', 0.3);

      mapGroup.append('line')
        .attr('x1', pt.x + 14)
        .attr('y1', 0)
        .attr('x2', pt.x + 14)
        .attr('y2', height)
        .attr('stroke', '#334155')
        .attr('stroke-width', 0.8)
        .attr('stroke-opacity', 0.3);

      // Cross street centerline
      mapGroup.append('line')
        .attr('x1', pt.x)
        .attr('y1', 0)
        .attr('x2', pt.x)
        .attr('y2', height)
        .attr('stroke', '#334155')
        .attr('stroke-width', 0.8)
        .attr('stroke-dasharray', '3,3')
        .attr('stroke-opacity', 0.25);

      // Cross street label
      const crossName = pt.node.name.split('&')[1]?.trim() || `St ${pt.idx + 1}`;
      mapGroup.append('text')
        .attr('x', pt.x)
        .attr('y', height - 6)
        .attr('text-anchor', 'middle')
        .attr('font-size', '7px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('fill', '#475569')
        .attr('opacity', 0.75)
        .text(crossName.toUpperCase());

      // Pedestrian crosswalk hashes at the intersection
      [-12, 12].forEach(offset => {
        mapGroup.append('line')
          .attr('x1', pt.x - 12)
          .attr('y1', pt.y + offset)
          .attr('x2', pt.x + 12)
          .attr('y2', pt.y + offset)
          .attr('stroke', '#334155')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '2,2')
          .attr('stroke-opacity', 0.4);
      });
    });

    // City Block Parcels / Building Footprints between streets
    for (let i = 0; i <= nodePoints.length; i++) {
      const leftX = i === 0 ? 8 : nodePoints[i - 1].x + 18;
      const rightX = i === nodePoints.length ? width - 8 : nodePoints[i].x - 18;
      const blockWidth = rightX - leftX;

      if (blockWidth > 15) {
        // North city block
        mapGroup.append('rect')
          .attr('x', leftX)
          .attr('y', northAvenueY + 10)
          .attr('width', blockWidth)
          .attr('height', Math.max(10, arterialY - northAvenueY - 26))
          .attr('rx', 2)
          .attr('fill', '#334155')
          .attr('fill-opacity', 0.035)
          .attr('stroke', '#334155')
          .attr('stroke-width', 0.5)
          .attr('stroke-opacity', 0.25);

        // South city block
        mapGroup.append('rect')
          .attr('x', leftX)
          .attr('y', arterialY + 26)
          .attr('width', blockWidth)
          .attr('height', Math.max(10, southAvenueY - arterialY - 36))
          .attr('rx', 2)
          .attr('fill', '#334155')
          .attr('fill-opacity', 0.035)
          .attr('stroke', '#334155')
          .attr('stroke-width', 0.5)
          .attr('stroke-opacity', 0.25);
      }
    }

    // THIN MUTED SLATE-700 LINES CONNECTING THE INTERSECTION NODES
    const lineGen = d3.line<{ x: number; y: number }>()
      .x(d => d.x)
      .y(d => d.y);

    const corridorGroup = svg.append('g').attr('class', 'emergency-corridor-route');

    // Arterial Road Boundary / Shoulder Lines
    [-18, 18].forEach(offset => {
      const shoulderPoints = nodePoints.map(p => ({ x: p.x, y: p.y + offset }));
      if (shoulderPoints.length > 0) {
        const fullPath = [
          { x: 0, y: shoulderPoints[0].y },
          ...shoulderPoints,
          { x: width, y: shoulderPoints[shoulderPoints.length - 1].y }
        ];
        corridorGroup.append('path')
          .datum(fullPath)
          .attr('d', lineGen)
          .attr('fill', 'none')
          .attr('stroke', '#334155') // slate-700
          .attr('stroke-width', 1.0)
          .attr('stroke-opacity', 0.5)
          .attr('stroke-dasharray', offset < 0 ? '4,4' : 'none');
      }
    });

    // Connecting baseline through all nodes: thin muted slate-700 lines
    const extendedNodePath = [
      { x: 0, y: nodePoints[0]?.y || arterialY },
      ...nodePoints.map(p => ({ x: p.x, y: p.y })),
      { x: width, y: nodePoints[nodePoints.length - 1]?.y || arterialY }
    ];

    corridorGroup.append('path')
      .datum(extendedNodePath)
      .attr('d', lineGen)
      .attr('fill', 'none')
      .attr('stroke', '#334155') // slate-700
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.7);

    // Connecting line segments between adjacent intersection nodes
    for (let i = 0; i < nodePoints.length - 1; i++) {
      const p1 = nodePoints[i];
      const p2 = nodePoints[i + 1];
      const isPast = p1.idx < this.state.currentStageIndex;
      const isCurrent = p1.idx === this.state.currentStageIndex;

      // Base thin muted slate-700 connecting line
      corridorGroup.append('line')
        .attr('x1', p1.x)
        .attr('y1', p1.y)
        .attr('x2', p2.x)
        .attr('y2', p2.y)
        .attr('stroke', '#334155') // slate-700
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.85);

      // Preemption highlight overlay
      if (isPast) {
        corridorGroup.append('line')
          .attr('x1', p1.x)
          .attr('y1', p1.y)
          .attr('x2', p2.x)
          .attr('y2', p2.y)
          .attr('stroke', '#10b981') // emerald-500
          .attr('stroke-width', 2.0)
          .attr('stroke-opacity', 0.7);
      } else if (isCurrent && this.state.isRunning) {
        const curProgress = this.state.progress;
        const midX = p1.x + (p2.x - p1.x) * curProgress;
        corridorGroup.append('line')
          .attr('x1', p1.x)
          .attr('y1', p1.y)
          .attr('x2', midX)
          .attr('y2', p2.y)
          .attr('stroke', '#3b82f6') // blue-500
          .attr('stroke-width', 2.5)
          .attr('stroke-opacity', 0.9)
          .attr('filter', 'url(#corridor-glow)');
      }
    }

    // Intersection Node Map Junctions: concentric radar rings & crosshairs
    const markersGroup = svg.append('g').attr('class', 'intersection-markers');

    nodePoints.forEach(pt => {
      const isCurrent = pt.idx === this.state.currentStageIndex;
      const isPast = pt.idx < this.state.currentStageIndex;

      // Outer radar target ring: thin muted slate-700
      markersGroup.append('circle')
        .attr('cx', pt.x)
        .attr('cy', pt.y)
        .attr('r', 18)
        .attr('fill', 'none')
        .attr('stroke', '#334155') // slate-700
        .attr('stroke-width', 0.8)
        .attr('stroke-dasharray', '3,3')
        .attr('stroke-opacity', 0.45);

      // Inner junction anchor ring
      markersGroup.append('circle')
        .attr('cx', pt.x)
        .attr('cy', pt.y)
        .attr('r', 8)
        .attr('fill', '#0f172a') // slate-900
        .attr('fill-opacity', 0.15)
        .attr('stroke', '#334155') // slate-700
        .attr('stroke-width', 1.0)
        .attr('stroke-opacity', 0.6);

      // Dynamic preemption ring
      if (isCurrent) {
        markersGroup.append('circle')
          .attr('cx', pt.x)
          .attr('cy', pt.y)
          .attr('r', 22)
          .attr('fill', 'none')
          .attr('stroke', '#ef4444') // red-500
          .attr('stroke-width', 1.5)
          .attr('stroke-opacity', 0.8)
          .attr('filter', 'url(#corridor-glow)');
      } else if (isPast) {
        markersGroup.append('circle')
          .attr('cx', pt.x)
          .attr('cy', pt.y)
          .attr('r', 14)
          .attr('fill', 'none')
          .attr('stroke', '#10b981') // emerald-500
          .attr('stroke-width', 1.2)
          .attr('stroke-opacity', 0.6);
      }
    });
  }

  private updateTelemetryTableOnly() {
    const tbody = this.elements['node-matrix-tbody'];
    if (!tbody) return;

    tbody.innerHTML = '';
    this.nodes.forEach((node, idx) => {
      const isCurrent = idx === this.state.currentStageIndex;
      const isPast = idx < this.state.currentStageIndex;

      let signalClass = 'text-red-700 font-bold';
      let signalBadge = 'bg-red-50 text-red-700 border-red-200';
      if (node.signalState === 'GREEN') {
        signalClass = 'text-emerald-700 font-bold';
        signalBadge = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      } else if (node.signalState === 'YELLOW') {
        signalClass = 'text-amber-700 font-bold';
        signalBadge = 'bg-amber-50 text-amber-700 border-amber-200';
      }

      let lockBadge = 'bg-slate-100 text-slate-600 border-slate-200';
      if (isCurrent) {
        lockBadge = 'bg-red-50 text-red-700 border-red-200 font-bold';
      } else if (isPast) {
        lockBadge = 'bg-emerald-50 text-emerald-700 border-emerald-200 font-bold';
      }

      const tr = document.createElement('tr');
      tr.className = `hover:bg-slate-50 transition-colors ${isCurrent ? 'bg-red-50/20' : ''}`;
      tr.innerHTML = `
        <td class="py-2 px-2.5 font-bold text-slate-900">${node.id} <span class="text-[10px] text-slate-400 font-normal">(${node.ip.split('.').slice(-1)[0]})</span></td>
        <td class="py-2 px-2.5 text-slate-700 font-medium">${node.name}</td>
        <td class="py-2 px-2.5">
          <span class="px-1.5 py-0.5 rounded border text-[10px] font-mono ${signalBadge}">
            ${node.signalState}
          </span>
        </td>
        <td class="py-2 px-2.5">
          <span class="px-1.5 py-0.5 rounded border text-[10px] font-mono ${lockBadge}">
            ${isCurrent ? 'ACTIVE LOCK' : isPast ? 'RELEASED' : 'STANDBY'}
          </span>
        </td>
        <td class="py-2 px-2.5 tabular-nums text-slate-600">${node.detectorLatency} ms</td>
        <td class="py-2 px-2.5 text-slate-600">${node.queueStatus}</td>
      `;
      tbody.appendChild(tr);
    });

    if (this.elements['topology-summary']) {
      this.elements['topology-summary'].textContent = `${this.nodes.length} CORRIDOR NODES MONITORED // ALL CHANNELS SECURE`;
    }
  }

  // ==========================================================================
  // Real-Time Telemetry Event Stream (Terminal Log)
  // ==========================================================================

  private initTerminalTelemetry() {
    this.addLog('SYSTEM-BOOT', 'Corridor telemetry and signal network monitoring active.');
    this.addLog('SAFETY-CHECK', 'Safety interlock diagnostics completed. Zero conflicting movements.');
    this.addLog('STANDBY', `Corridor armed for ${this.config.intersections} coordinated intersections.`);
  }

  public addLog(tag: string, message: string) {
    const terminal = this.elements['safeguard-terminal-log'];
    if (!terminal) return;

    this.state.logCount++;
    if (this.elements['log-count-badge']) {
      this.elements['log-count-badge'].textContent = `${this.state.logCount} Frames`;
    }

    const now = new Date();
    const timeStr = `${now.toTimeString().split(' ')[0]}.${now.getMilliseconds().toString().padStart(3, '0')}`;

    let tagColor = 'text-cyan-400';
    if (tag.includes('SIGNAL') || tag.includes('BROADCAST')) tagColor = 'text-amber-400';
    else if (tag.includes('ALL-RED') || tag.includes('HOLD') || tag.includes('SAFETY')) tagColor = 'text-red-400 font-bold';
    else if (tag.includes('GREEN') || tag.includes('PREEMPT') || tag.includes('COMPLETE')) tagColor = 'text-emerald-400 font-bold';
    else if (tag.includes('RESTORE') || tag.includes('RECOVERY')) tagColor = 'text-purple-400';
    else if (tag.includes('PED')) tagColor = 'text-yellow-400';

    // Record telemetry frame for audit export
    const currentNode = this.nodes[this.state.currentStageIndex];
    const currentPhase = this.elements['scada-phase-badge']?.textContent || 'CORRIDOR MONITOR';
    this.logRecords.push({
      frameId: this.state.logCount,
      timestampIso: now.toISOString(),
      tag,
      activeNode: currentNode ? `${currentNode.id} (${currentNode.name})` : 'SYSTEM BUS',
      phaseInterval: currentPhase.trim(),
      message
    });

    const line = document.createElement('div');
    line.className = 'border-b border-slate-900 pb-1';
    line.innerHTML = `
      <span class="text-slate-500">[${timeStr}]</span>
      <span class="${tagColor}">[${tag}]</span>
      <span class="text-slate-200">${message}</span>
    `;

    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
  }

  private exportTelemetryCsv() {
    if (this.logRecords.length === 0) {
      this.addLog('AUDIT-WARN', 'No telemetry records available to export.');
      return;
    }

    const escapeCsv = (val: string | number) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'Frame_ID',
      'Timestamp_UTC',
      'Subsystem_Tag',
      'Corridor_Node',
      'Safety_Phase_Interval',
      'Telemetry_Payload'
    ];

    const csvRows = [headers.join(',')];
    this.logRecords.forEach(r => {
      csvRows.push([
        r.frameId,
        escapeCsv(r.timestampIso),
        escapeCsv(r.tag),
        escapeCsv(r.activeNode),
        escapeCsv(r.phaseInterval),
        escapeCsv(r.message)
      ].join(','));
    });

    const csvContent = csvRows.join('\r\n');

    // Trigger standard browser download via Blob
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `SCADA_Corridor_Telemetry_${dateStr}.csv`;

    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', filename);
    downloadAnchor.style.display = 'none';
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
    URL.revokeObjectURL(url);

    // Visual button confirmation
    const btnLabel = this.elements['export-telemetry-label'];
    if (btnLabel) {
      const origText = btnLabel.textContent;
      btnLabel.textContent = `✓ EXPORTED (${this.logRecords.length} FRAMES)`;
      setTimeout(() => {
        if (btnLabel) btnLabel.textContent = origText;
      }, 2000);
    }

    this.addLog('AUDIT-EXPORT', `Generated CSV telemetry file (${this.logRecords.length} frames). Download dispatched: ${filename}`);
  }

  // ==========================================================================
  // SCADA Simulation Loop & State Machine
  // ==========================================================================

  private startSimulation() {
    this.state.currentStageIndex = 0;
    this.state.totalStages = this.config.intersections;
    this.state.phaseIndex = 0;
    this.state.progress = 0;
    this.state.isRunning = true;
    this.state.isPaused = false;

    this.updateControlsUI();
    this.renderTopologyMatrix();

    const currentNode = this.nodes[0];
    this.addLog('INGRESS-DETECTION', `Optical strobe pulse registered at ${currentNode.id} (${currentNode.name}). Distance: 450m.`);

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.lastTimestamp = performance.now();
    this.animationFrameId = requestAnimationFrame((ts) => this.simulationLoop(ts));
  }

  private togglePlayPause() {
    this.state.isPaused = !this.state.isPaused;
    this.updateControlsUI();
    if (!this.state.isPaused && this.state.isRunning) {
      this.lastTimestamp = performance.now();
      this.animationFrameId = requestAnimationFrame((ts) => this.simulationLoop(ts));
      this.addLog('OPERATOR-CMD', 'Telemetry stream resumed by operator.');
    } else {
      this.addLog('OPERATOR-CMD', 'Telemetry stream paused for parameter inspection.');
    }
  }

  private restartSimulation() {
    this.state.currentStageIndex = 0;
    this.state.phaseIndex = 0;
    this.state.progress = 0;
    this.state.isPaused = false;
    this.state.isRunning = true;
    this.initNodes();
    this.resetCivilianCars();
    this.updateControlsUI();
    this.renderTopologyMatrix();
    this.renderTelemetryFrame(0);
    this.addLog('CORRIDOR-RESET', 'Corridor telemetry timeline reset to Node A ingress point.');
    this.lastTimestamp = performance.now();
    this.animationFrameId = requestAnimationFrame((ts) => this.simulationLoop(ts));
  }

  private stepSimulation() {
    this.state.isPaused = true;
    this.updateControlsUI();
    this.state.progress += 0.2;
    if (this.state.progress >= 1.0) {
      this.state.progress = 0;
      if (this.state.currentStageIndex < this.state.totalStages - 1) {
        this.state.currentStageIndex++;
        this.renderTopologyMatrix();
      }
    }

    let crossSignal: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
    if (this.state.progress < 0.35) crossSignal = 'GREEN';
    else if (this.state.progress < 0.60) crossSignal = 'YELLOW';
    else if (this.state.progress < 0.93) crossSignal = 'RED';
    else crossSignal = 'GREEN';
    this.updateCivilianPhysics(0.35, crossSignal);

    this.renderTelemetryFrame(this.state.progress);
    this.addLog('OPERATOR-STEP', `Single cycle step executed: Stage ${this.state.currentStageIndex + 1}, Frame ${Math.round(this.state.progress * 100)}%`);
  }

  private updateControlsUI() {
    const label = this.elements['label-play-pause'];
    const indicator = this.elements['scada-status-indicator'];
    const stateLabel = this.elements['scada-state-label'];
    const headerState = this.elements['scada-system-state'];

    if (this.state.isPaused) {
      if (label) label.textContent = 'RESUME';
      if (indicator) indicator.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
      if (stateLabel) stateLabel.textContent = 'PAUSED';
      if (headerState) {
        headerState.textContent = 'PAUSED';
        headerState.className = 'font-bold text-amber-700';
      }
    } else {
      if (label) label.textContent = 'PAUSE';
      if (indicator) indicator.className = 'w-2.5 h-2.5 rounded-full bg-emerald-600';
      if (stateLabel) stateLabel.textContent = 'RUNNING';
      if (headerState) {
        headerState.textContent = 'ACTIVE PREEMPTION';
        headerState.className = 'font-bold text-emerald-700';
      }
    }
  }

  private simulationLoop(timestamp: number) {
    if (!this.state.isRunning || this.state.isPaused) return;

    const deltaMs = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    const baseCycleDurationMs = 6000;
    const progressDelta = (deltaMs / baseCycleDurationMs) * this.state.speedMultiplier;
    this.state.progress += progressDelta;

    // Update Civilian Cross-Traffic Physics in lockstep with simulation
    const dtSec = Math.min(0.1, (deltaMs / 1000) * this.state.speedMultiplier);
    let crossSignal: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
    if (this.state.progress < 0.35) crossSignal = 'GREEN';
    else if (this.state.progress < 0.60) crossSignal = 'YELLOW';
    else if (this.state.progress < 0.93) crossSignal = 'RED';
    else crossSignal = 'GREEN';
    this.updateCivilianPhysics(dtSec, crossSignal);

    if (this.state.progress >= 1.0) {
      this.state.progress = 0;
      if (this.state.currentStageIndex < this.state.totalStages - 1) {
        // Mark past node as cleared
        this.nodes[this.state.currentStageIndex].preemptLock = 'CLEARED';
        this.nodes[this.state.currentStageIndex].signalState = 'GREEN';
        this.nodes[this.state.currentStageIndex].queueStatus = '0 queued (CLEAR)';

        this.state.currentStageIndex++;
        this.renderTopologyMatrix();
        const nextNode = this.nodes[this.state.currentStageIndex];
        this.addLog('CORRIDOR-HANDSHAKE', `${this.nodes[this.state.currentStageIndex - 1].id} cleared. Transferring preemption lock to ${nextNode.id} (${nextNode.name}).`);
      } else {
        this.handleCorridorFinished();
        return;
      }
    }

    this.renderTelemetryFrame(this.state.progress);
    this.animationFrameId = requestAnimationFrame((ts) => this.simulationLoop(ts));
  }

  private handleCorridorFinished() {
    this.state.isRunning = false;
    this.updateControlsUI();

    this.nodes.forEach(n => {
      n.preemptLock = 'CLEARED';
      n.signalState = 'GREEN';
      n.queueStatus = '0 queued (CLEAR)';
    });
    this.renderTopologyMatrix();

    if (this.elements['scada-phase-badge']) {
      this.elements['scada-phase-badge'].textContent = 'ALL NODES CLEARED // RECOVERY SYNC';
      this.elements['scada-phase-badge'].className = 'text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200';
    }

    if (this.elements['lidar-hud-wave-status']) {
      this.elements['lidar-hud-wave-status'].textContent = 'ALL NODES CLEARED';
      this.elements['lidar-hud-wave-status'].className = 'text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200';
    }
    if (this.elements['lidar-hud-distance']) {
      this.elements['lidar-hud-distance'].textContent = '0m (PASSED)';
    }
    if (this.elements['lidar-hud-time-remaining']) {
      this.elements['lidar-hud-time-remaining'].textContent = '00.0s';
    }
    if (this.elements['lidar-hud-cross-traffic']) {
      this.elements['lidar-hud-cross-traffic'].textContent = 'RESUMING FLOW';
      this.elements['lidar-hud-cross-traffic'].className = 'text-emerald-400 font-bold';
    }
    if (this.elements['lidar-hud-safety-clearance']) {
      this.elements['lidar-hud-safety-clearance'].textContent = '100% SECURED';
      this.elements['lidar-hud-safety-clearance'].className = 'text-emerald-400 font-bold';
    }

    this.setSignalLight('sig-west', 'GREEN');
    this.setSignalLight('sig-east', 'GREEN');
    this.setSignalLight('sig-north', 'GREEN');
    this.setSignalLight('sig-south', 'GREEN');

    // Resume civilian cars across intersection
    this.updateCivilianPhysics(0.5, 'GREEN');

    const vehicleEl = this.elements['lidar-emergency-vehicle'];
    if (vehicleEl) {
      vehicleEl.style.left = '108%';
    }

    const saved = this.elements['kpi-time-saved']?.textContent || '05m 15s';
    this.addLog('CORRIDOR-COMPLETE', `All ${this.config.intersections} intersection nodes successfully traversed under preemption priority. Net delay reduction: ${saved}.`);
  }

  // ==========================================================================
  // Live Frame Telemetry State Machine & 2D LiDAR Physical Map Sync
  // ==========================================================================

  private setSignalLight(prefix: string, color: 'RED' | 'YELLOW' | 'GREEN') {
    const red = this.elements[`${prefix}-red`];
    const yellow = this.elements[`${prefix}-yellow`];
    const green = this.elements[`${prefix}-green`];

    if (!red || !yellow || !green) return;

    // Reset base inactive state
    red.className = 'w-2.5 h-2.5 rounded-full bg-slate-700 transition-all';
    yellow.className = 'w-2.5 h-2.5 rounded-full bg-slate-700 transition-all';
    green.className = 'w-2.5 h-2.5 rounded-full bg-slate-700 transition-all';

    if (color === 'RED') {
      red.className = 'w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444] transition-all';
    } else if (color === 'YELLOW') {
      yellow.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_#f59e0b] transition-all';
    } else if (color === 'GREEN') {
      green.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#10b981] transition-all';
    }
  }

  private updateLidar2DMap(p: number, currentNode: NodeTelemetry) {
    // 1. Vehicle position along East-West roadway (-12% ingress to 108% egress)
    const vehicleEl = this.elements['lidar-emergency-vehicle'];
    if (vehicleEl) {
      const leftPercent = -12 + (p * 120);
      vehicleEl.style.left = `${leftPercent.toFixed(1)}%`;
    }

    // 2. HUD Labels
    const hudJunction = this.elements['lidar-hud-junction-name'];
    if (hudJunction) {
      hudJunction.textContent = `${currentNode.name}`;
    }

    const hudDistance = this.elements['lidar-hud-distance'];
    if (hudDistance) {
      const dist = Math.max(0, Math.round(450 * Math.max(0, 1 - p / 0.82)));
      hudDistance.textContent = `${dist}m`;
    }

    const hudTime = this.elements['lidar-hud-time-remaining'];
    if (hudTime) {
      const timeRemaining = Math.max(0, (7.5 * Math.max(0, 1 - p / 0.82))).toFixed(1);
      hudTime.textContent = `${timeRemaining}s`;
    }

    const hudWave = this.elements['lidar-hud-wave-status'];
    const hudSafety = this.elements['lidar-hud-safety-clearance'];
    const hudCross = this.elements['lidar-hud-cross-traffic'];
    const pedNorth = this.elements['lidar-ped-sign-north'];
    const pedSouth = this.elements['lidar-ped-sign-south'];
    const sensorPulse = this.elements['lidar-sensor-loop-pulse'];

    if (p < 0.22) {
      // Phase 1: Ingress (450m detection)
      this.setSignalLight('sig-west', 'RED');
      this.setSignalLight('sig-east', 'RED');
      this.setSignalLight('sig-north', 'GREEN');
      this.setSignalLight('sig-south', 'GREEN');

      if (pedNorth) {
        pedNorth.textContent = 'WALK';
        pedNorth.className = 'text-emerald-400 font-bold';
      }
      if (pedSouth) {
        pedSouth.textContent = 'WALK';
        pedSouth.className = 'text-emerald-400 font-bold';
      }
      if (hudWave) {
        hudWave.textContent = 'INGRESS REGISTERED';
        hudWave.className = 'text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded border border-blue-200';
      }
      if (hudSafety) {
        hudSafety.textContent = 'ARMING';
        hudSafety.className = 'text-blue-400 font-bold';
      }
      if (hudCross) {
        hudCross.textContent = 'FLOWING (FREE)';
        hudCross.className = 'text-emerald-400 font-bold';
      }
      if (sensorPulse) {
        sensorPulse.className = 'w-4 h-16 border-2 border-dashed border-cyan-300 rounded bg-cyan-400/30 flex items-center justify-center animate-pulse';
      }
    } else if (p < 0.42) {
      // Phase 2: Pedestrian Clearance Truncation
      this.setSignalLight('sig-west', 'RED');
      this.setSignalLight('sig-east', 'RED');
      this.setSignalLight('sig-north', 'GREEN');
      this.setSignalLight('sig-south', 'GREEN');

      if (pedNorth) {
        pedNorth.textContent = 'CLEARING';
        pedNorth.className = 'text-amber-400 font-bold animate-pulse';
      }
      if (pedSouth) {
        pedSouth.textContent = 'CLEARING';
        pedSouth.className = 'text-amber-400 font-bold animate-pulse';
      }
      if (hudWave) {
        hudWave.textContent = 'PEDESTRIAN BUFFER';
        hudWave.className = 'text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200';
      }
      if (hudSafety) {
        hudSafety.textContent = 'CROSSWALK CLEARING';
        hudSafety.className = 'text-amber-400 font-bold';
      }
      if (hudCross) {
        hudCross.textContent = 'PREPARING QUEUE';
        hudCross.className = 'text-amber-400 font-bold';
      }
      if (sensorPulse) {
        sensorPulse.className = 'w-4 h-16 border-2 border-dashed border-cyan-400/70 rounded bg-cyan-500/10 flex items-center justify-center';
      }
    } else if (p < 0.60) {
      // Phase 3: Cross-Traffic Yellow Change
      this.setSignalLight('sig-west', 'RED');
      this.setSignalLight('sig-east', 'RED');
      this.setSignalLight('sig-north', 'YELLOW');
      this.setSignalLight('sig-south', 'YELLOW');

      if (pedNorth) {
        pedNorth.textContent = 'DONT WALK';
        pedNorth.className = 'text-red-400 font-bold';
      }
      if (pedSouth) {
        pedSouth.textContent = 'DONT WALK';
        pedSouth.className = 'text-red-400 font-bold';
      }
      if (hudWave) {
        hudWave.textContent = 'CROSS YELLOW CHANGE';
        hudWave.className = 'text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200';
      }
      if (hudSafety) {
        hudSafety.textContent = 'SLOWING CROSS';
        hudSafety.className = 'text-amber-400 font-bold';
      }
      if (hudCross) {
        hudCross.textContent = 'YELLOW DECEL / BRAKING';
        hudCross.className = 'text-amber-400 font-bold animate-pulse';
      }
    } else if (p < 0.76) {
      // Phase 4: All-Red Safety Buffer (ALL SIGNALS RED)
      this.setSignalLight('sig-west', 'RED');
      this.setSignalLight('sig-east', 'RED');
      this.setSignalLight('sig-north', 'RED');
      this.setSignalLight('sig-south', 'RED');

      if (pedNorth) {
        pedNorth.textContent = 'DONT WALK';
        pedNorth.className = 'text-red-400 font-bold';
      }
      if (pedSouth) {
        pedSouth.textContent = 'DONT WALK';
        pedSouth.className = 'text-red-400 font-bold';
      }
      if (hudWave) {
        hudWave.textContent = 'ALL-RED BUFFER';
        hudWave.className = 'text-red-700 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-200';
      }
      if (hudSafety) {
        hudSafety.textContent = 'BOX SECURED';
        hudSafety.className = 'text-red-400 font-bold';
      }
      if (hudCross) {
        hudCross.textContent = 'QUEUED AT STOP LINE (6 HELD)';
        hudCross.className = 'text-red-400 font-bold';
      }
    } else if (p < 0.93) {
      // Phase 5: Green Wave Corridor (Corridor GREEN, Cross RED)
      this.setSignalLight('sig-west', 'GREEN');
      this.setSignalLight('sig-east', 'GREEN');
      this.setSignalLight('sig-north', 'RED');
      this.setSignalLight('sig-south', 'RED');

      if (pedNorth) {
        pedNorth.textContent = 'DONT WALK';
        pedNorth.className = 'text-red-400 font-bold';
      }
      if (pedSouth) {
        pedSouth.textContent = 'DONT WALK';
        pedSouth.className = 'text-red-400 font-bold';
      }
      if (hudWave) {
        hudWave.textContent = 'GREEN WAVE OPEN';
        hudWave.className = 'text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200';
      }
      if (hudSafety) {
        hudSafety.textContent = '100% CLEAR';
        hudSafety.className = 'text-emerald-400 font-bold';
      }
      if (hudCross) {
        hudCross.textContent = 'HELD BEHIND STOP LINE';
        hudCross.className = 'text-red-400 font-bold';
      }
    } else {
      // Phase 6: Egress & Recovery
      this.setSignalLight('sig-west', 'GREEN');
      this.setSignalLight('sig-east', 'GREEN');
      this.setSignalLight('sig-north', 'RED');
      this.setSignalLight('sig-south', 'RED');

      if (hudWave) {
        hudWave.textContent = 'RECOVERY SYNC';
        hudWave.className = 'text-slate-700 font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-300';
      }
      if (hudSafety) {
        hudSafety.textContent = 'RESTORED';
        hudSafety.className = 'text-slate-400 font-bold';
      }
      if (hudCross) {
        hudCross.textContent = 'RESUMING FLOW';
        hudCross.className = 'text-emerald-400 font-bold';
      }
    }
  }

  // ==========================================================================
  // Civilian Cross-Traffic Physics, Queuing & Collision Prevention
  // ==========================================================================

  private updateCivilianPhysics(dtSec: number, crossSignal: 'GREEN' | 'YELLOW' | 'RED') {
    const isCrossClear = crossSignal === 'GREEN';

    // 1. Southbound Vehicles (Move Down, Y increases)
    const sb = this.civilianCars.filter(c => c.lane === 'southbound');
    for (let i = 0; i < sb.length; i++) {
      const car = sb[i];
      const precedingCar = i > 0 ? sb[i - 1] : null;

      if (isCrossClear) {
        // Light is Green: traffic moves downward smoothly across intersection
        car.isBraking = false;
        car.isStopped = false;
        car.y += car.speed * dtSec;

        // Wrap around when vehicle exits bottom of screen
        if (car.y > 175) {
          const highestY = Math.min(...sb.map(c => c.y));
          car.y = Math.min(-180, highestY - 46);
        }

        // Prevent bumping into preceding car
        if (precedingCar && car.y > precedingCar.y - 44 && precedingCar.y > car.y) {
          car.y = precedingCar.y - 44;
        }
      } else {
        // Light is Yellow or Red: vehicles stop behind stop line in queue
        // A car that has already crossed the intersection box (past Y = -40) clears through
        if (car.y > -40 && car.y < 160) {
          car.isBraking = false;
          car.isStopped = false;
          car.y += car.speed * dtSec;
        } else if (car.y < car.stopY) {
          // Approach queue position with realistic deceleration
          const dist = car.stopY - car.y;
          const currentSpeed = Math.min(car.speed, Math.max(16, dist * 3.2));
          car.y += currentSpeed * dtSec;
          car.isBraking = true;
          if (car.y >= car.stopY) {
            car.y = car.stopY;
            car.isStopped = true;
          }
        } else if (car.y > 160) {
          car.y = -220 - (i * 44);
          car.isStopped = false;
          car.isBraking = false;
        } else {
          car.y = car.stopY;
          car.isStopped = true;
          car.isBraking = true;
        }

        if (precedingCar && precedingCar.isStopped && car.y > precedingCar.y - 44) {
          car.y = precedingCar.y - 44;
          car.isStopped = true;
          car.isBraking = true;
        }
      }
    }

    // 2. Northbound Vehicles (Move Up, Y decreases)
    const nb = this.civilianCars.filter(c => c.lane === 'northbound');
    for (let i = 0; i < nb.length; i++) {
      const car = nb[i];
      const precedingCar = i > 0 ? nb[i - 1] : null;

      if (isCrossClear) {
        // Light is Green: traffic moves upward smoothly across intersection
        car.isBraking = false;
        car.isStopped = false;
        car.y -= car.speed * dtSec;

        // Wrap around when vehicle exits top of screen
        if (car.y < -175) {
          const lowestY = Math.max(...nb.map(c => c.y));
          car.y = Math.max(180, lowestY + 46);
        }

        // Prevent tailgating
        if (precedingCar && car.y < precedingCar.y + 44 && precedingCar.y < car.y) {
          car.y = precedingCar.y + 44;
        }
      } else {
        // Light is Yellow or Red: vehicles stop behind stop line in queue
        if (car.y < 40 && car.y > -160) {
          // Has already entered intersection box, clears through
          car.isBraking = false;
          car.isStopped = false;
          car.y -= car.speed * dtSec;
        } else if (car.y > car.stopY) {
          // Decelerate towards stop line
          const dist = car.y - car.stopY;
          const currentSpeed = Math.min(car.speed, Math.max(16, dist * 3.2));
          car.y -= currentSpeed * dtSec;
          car.isBraking = true;
          if (car.y <= car.stopY) {
            car.y = car.stopY;
            car.isStopped = true;
          }
        } else if (car.y < -160) {
          car.y = 220 + (i * 44);
          car.isStopped = false;
          car.isBraking = false;
        } else {
          car.y = car.stopY;
          car.isStopped = true;
          car.isBraking = true;
        }

        if (precedingCar && precedingCar.isStopped && car.y < precedingCar.y + 44) {
          car.y = precedingCar.y + 44;
          car.isStopped = true;
          car.isBraking = true;
        }
      }
    }

    // 3. Render Positions and Brake Lights to DOM
    this.renderCivilianCarsDOM();
  }

  private renderCivilianCarsDOM() {
    this.civilianCars.forEach(car => {
      const el = document.getElementById(car.id);
      if (!el) return;

      el.style.top = `calc(50% + ${car.y.toFixed(1)}px)`;

      // Brake lights activation
      const brakes = el.querySelectorAll('.civ-brake');
      brakes.forEach(b => {
        if (car.isBraking || car.isStopped) {
          b.className = 'w-1 h-1 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444] civ-brake';
        } else {
          b.className = 'w-1 h-1 rounded-full bg-red-950 civ-brake';
        }
      });
    });
  }

  private resetCivilianCars() {
    this.civilianCars[0].y = -92;
    this.civilianCars[1].y = -138;
    this.civilianCars[2].y = -184;

    this.civilianCars[3].y = 56;
    this.civilianCars[4].y = 102;
    this.civilianCars[5].y = 148;

    this.civilianCars.forEach(c => {
      c.isBraking = false;
      c.isStopped = false;
    });

    this.renderCivilianCarsDOM();
  }

  private renderTelemetryFrame(p: number) {
    const currentNode = this.nodes[this.state.currentStageIndex];
    if (!currentNode) return;

    if (this.elements['scada-active-node-name']) {
      this.elements['scada-active-node-name'].textContent = `${currentNode.id} (${currentNode.name})`;
    }

    // Update 2D LiDAR Top-Down Physical Intersection Animation
    this.updateLidar2DMap(p, currentNode);

    const timerGreen = this.elements['timer-green-ext'];
    const timerYellow = this.elements['timer-yellow-change'];
    const timerAllRed = this.elements['timer-all-red'];
    const timerPed = this.elements['timer-ped-clearance'];

    const statusGreen = this.elements['status-green-ext'];
    const statusYellow = this.elements['status-yellow-change'];
    const statusAllRed = this.elements['status-all-red'];
    const statusPed = this.elements['status-ped-clearance'];

    const phaseBadge = this.elements['scada-phase-badge'];
    const phase2Row = this.elements['phase-row-2-state'];
    const phase4Row = this.elements['phase-row-4-state'];
    const phase6Row = this.elements['phase-row-6-state'];

    // Phase 1: Ingress & Queue Detection (p: 0.0 - 0.22)
    if (p < 0.22) {
      if (this.state.phaseIndex !== 1) {
        this.state.phaseIndex = 1;
        currentNode.signalState = 'RED';
        currentNode.preemptLock = 'ACTIVE';
        currentNode.queueStatus = '4 queued (Holding)';
        this.updateTelemetryTableOnly();
        this.addLog('DETECTOR-PULSE', `${currentNode.id}: Priority preempt pulse verified. Ingress distance 450m.`);
      }
      if (phaseBadge) {
        phaseBadge.textContent = 'PHASE 1: INGRESS DETECTOR TRIGGER';
        phaseBadge.className = 'text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200';
      }
      if (timerGreen) timerGreen.textContent = '45.0s';
      if (statusGreen) statusGreen.textContent = 'QUEUED FOR ACTUATION';
      if (timerYellow) timerYellow.textContent = '03.0s';
      if (statusYellow) statusYellow.textContent = 'STANDBY';
      if (timerAllRed) timerAllRed.textContent = '02.0s';
      if (statusAllRed) statusAllRed.textContent = 'ARMED';
      if (timerPed) timerPed.textContent = `${this.config.pedClearanceTime}.0s`;
      if (statusPed) statusPed.textContent = 'COUNTDOWN TRIGGER';

      if (phase2Row) phase2Row.textContent = 'CALL REGISTERED';
      if (phase4Row) phase4Row.textContent = 'ACTIVE GREEN (HOLDING)';
    }

    // Phase 2: Pedestrian Truncation Interval (p: 0.22 - 0.42)
    else if (p < 0.42) {
      if (this.state.phaseIndex !== 2) {
        this.state.phaseIndex = 2;
        this.addLog('PED-TRUNCATE', `${currentNode.id}: Walk phase terminated. Pedestrian clearance interval active (${this.config.pedClearanceTime}s).`);
      }
      if (phaseBadge) {
        phaseBadge.textContent = 'PHASE 2: PEDESTRIAN CLEARANCE TRUNCATION';
        phaseBadge.className = 'text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200';
      }

      const pedRemaining = (this.config.pedClearanceTime * (1 - (p - 0.22) / 0.2)).toFixed(1);
      if (timerPed) timerPed.textContent = `${pedRemaining}s`;
      if (statusPed) statusPed.textContent = 'FLASHING DONT WALK';

      if (phase4Row) phase4Row.textContent = 'CROSS WALK TRUNCATING';
    }

    // Phase 3: Vehicular Yellow Change Interval (p: 0.42 - 0.60)
    else if (p < 0.60) {
      if (this.state.phaseIndex !== 3) {
        this.state.phaseIndex = 3;
        currentNode.signalState = 'YELLOW';
        currentNode.queueStatus = '2 queued (Draining)';
        this.updateTelemetryTableOnly();
        this.addLog('SIGNAL-YELLOW', `${currentNode.id}: Cross-traffic signal switched to Yellow (3.0s) to prepare safe corridor.`);
        this.addLog('CIVILIAN-HOLD', `${currentNode.id}: Cross signal Yellow. 6 civilian vehicles decelerating and holding behind stop line.`);
      }
      if (phaseBadge) {
        phaseBadge.textContent = 'PHASE 3: YELLOW CLEARANCE INTERVAL (3.0s)';
        phaseBadge.className = 'text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200';
      }

      const yellowRemaining = (3.0 * (1 - (p - 0.42) / 0.18)).toFixed(1);
      if (timerYellow) timerYellow.textContent = `${yellowRemaining}s`;
      if (statusYellow) statusYellow.textContent = 'CLEARING CROSS-TRAFFIC';
      if (timerPed) timerPed.textContent = '00.0s';
      if (statusPed) statusPed.textContent = 'DONT WALK (LOCKED)';

      if (phase4Row) phase4Row.textContent = 'YELLOW CLEARANCE';
    }

    // Phase 4: All-Red Safety Buffer (p: 0.60 - 0.76)
    else if (p < 0.76) {
      if (this.state.phaseIndex !== 4) {
        this.state.phaseIndex = 4;
        currentNode.signalState = 'RED';
        currentNode.queueStatus = '1 queued (Decelerating)';
        this.updateTelemetryTableOnly();
        this.addLog('SAFETY-BUFFER', `${currentNode.id}: All-Red safety buffer active (2.0s). Intersection box fully clear.`);
        this.addLog('CONFLICT-PREVENTION', `${currentNode.id}: All civilian vehicles halted safely behind stop lines. Intersection box 100% clear.`);
      }
      if (phaseBadge) {
        phaseBadge.textContent = 'PHASE 4: ALL-RED SAFETY BUFFER (2.0s)';
        phaseBadge.className = 'text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200';
      }

      const allRedRemaining = (2.0 * (1 - (p - 0.60) / 0.16)).toFixed(1);
      if (timerAllRed) timerAllRed.textContent = `${allRedRemaining}s`;
      if (statusAllRed) statusAllRed.textContent = 'HOLDING ALL TRAFFIC';

      if (phase4Row) phase4Row.textContent = 'RED SAFETY LOCK';
      if (phase2Row) phase2Row.textContent = 'CORRIDOR GREEN READY';
    }

    // Phase 5: Preempted Green Extension Corridor (p: 0.76 - 0.93)
    else if (p < 0.93) {
      if (this.state.phaseIndex !== 5) {
        this.state.phaseIndex = 5;
        currentNode.signalState = 'GREEN';
        currentNode.queueStatus = '0 queued (CLEARED)';
        this.updateTelemetryTableOnly();
        this.addLog('GREEN-CORRIDOR', `${currentNode.id}: Green wave active. Priority passage secured.`);
        this.addLog('SAFE-CROSSING', `${currentNode.id}: Emergency vehicle traversing junction. Cross-traffic holds under fail-safe red interlock.`);
      }
      if (phaseBadge) {
        phaseBadge.textContent = 'PHASE 5: ACTIVE GREEN WAVE CORRIDOR';
        phaseBadge.className = 'text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200';
      }

      const greenRemaining = (45.0 * (1 - (p - 0.76) / 0.17)).toFixed(1);
      if (timerGreen) timerGreen.textContent = `${greenRemaining}s`;
      if (statusGreen) statusGreen.textContent = 'HOLDING GREEN UNTIL PASS';

      if (phase2Row) phase2Row.textContent = 'GREEN WAVE (ACTIVE)';
      if (phase4Row) phase4Row.textContent = 'CROSS TRAFFIC RED (LOCKED)';
      if (phase6Row) phase6Row.textContent = 'COORDINATED SYNC';
    }

    // Phase 6: Egress & Coordinated Recovery (p: 0.93 - 1.00)
    else {
      if (this.state.phaseIndex !== 6) {
        this.state.phaseIndex = 6;
        currentNode.queueStatus = '0 queued (CLEARED)';
        this.updateTelemetryTableOnly();
        this.addLog('NORMAL-RECOVERY', `${currentNode.id}: Emergency vehicle past junction. Restoring standard city traffic timing.`);
        this.addLog('CIVILIAN-RESUME', `${currentNode.id}: Emergency vehicle past junction. Cross-street green signal restored; queued civilian traffic released.`);
      }
      if (phaseBadge) {
        phaseBadge.textContent = 'PHASE 6: STANDARD TIMING RESTORATION';
        phaseBadge.className = 'text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-300';
      }

      if (timerGreen) timerGreen.textContent = '00.0s';
      if (statusGreen) statusGreen.textContent = 'CYCLE RESTORATION';
      if (phase2Row) phase2Row.textContent = 'STANDARD TIMING RESUMING';
      if (phase4Row) phase4Row.textContent = 'CALL RE-ARMING';
    }
  }
}

// ============================================================================
// DOM Ready Bootstrap
// ============================================================================

window.addEventListener('DOMContentLoaded', () => {
  new SCADACommandCenter();
});
