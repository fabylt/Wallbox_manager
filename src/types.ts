export type FlowMode = "ECO" | "MANUALE" | "OFF";
export type PathPreference = "API" | "MQTT" | "PARALLELO";

export interface FlowConfig {
  // Device API Entity IDs
  haUrl: string;
  chargerStatusEntity: string;
  chargerControlEntity: string; // p.es. number.wallbox_pulsar_max_charging_current
  lockEntity: string; // p.es. lock.wallbox_pulsar_max_locked
  pauseEntity: string; // p.es. switch.wallbox_pulsar_max_pause_resume
  solarPowerEntity: string; // p.es. sensor.power_meter_solar_production
  houseConsumptionEntity: string; // p.es. sensor.power_meter_house_consumption

  // MQTT Topics
  mqttBrokerHost: string;
  mqttBrokerPort: number;
  mqttStatusTopic: string; // wallbox/status
  mqttCurrentSetTopic: string; // wallbox/set/current
  mqttLockSetTopic: string; // wallbox/set/lock
  mqttPauseSetTopic: string; // wallbox/set/pause

  // Logic Thresholds
  sampleWindow: number; // numero di campionamenti per media mobile (e.g., 5 campioni = 5 minuti)
  hysteresisSeconds: number; // tempo minimo tra cambi di potenza (p.es. 180s o 300s)
  minChargeCurrent: number; // normalmente 6 Ampere minimo per EV standard
  maxChargeCurrent: number; // tipicamente 16 Ampere (monofase 3.7 kW) o 32 Ampere (7.4 kW)
  pvMultiplier: number; // Corrente = Surplus / (Volt * Fasi). Volt=230, Fasi=1
  singlePhaseVoltage: number; // Di solito 230V
  startThresholdWatts: number; // p.es. 1380 Watt (6A * 230V) per avviare
  stopThresholdWatts: number; // p.es. 500 Watt di tolleranza prelievo prima di staccare
}

export type NodeType =
  | "inject"
  | "sensor"
  | "function"
  | "switch"
  | "change"
  | "api-call"
  | "mqtt-out"
  | "mqtt-in"
  | "dashboard"
  | "status"
  | "delay";

export interface RedNode {
  id: string;
  label: string;
  type: NodeType;
  x: number;
  y: number;
  description: string;
  codeSnippet?: string;
  lastPayload?: string | number | boolean | Record<string, any>;
  hasError?: boolean;
}

export interface RedEdge {
  id: string;
  from: string;
  to: string;
}

export interface SimLog {
  id: string;
  timestamp: string;
  nodeLabel: string;
  message: string;
  type: "info" | "api" | "mqtt" | "warning" | "success";
  payload: any;
}

export interface SimulationState {
  // Inputs
  solarPower: number; // Watt
  houseConsumption: number; // Watt
  chargingMode: FlowMode;
  pathPreference: PathPreference;
  manualCurrent: number; // Ampere
  isPluggedIn: boolean;
  batteryPercent: number;
  
  // Realtime System Status
  chargerLocked: boolean;
  chargerCharging: boolean; // paused vs charging
  chargerCurrent: number; // Ampere
  rawSurplus: number; // Watt (Solar - House)
  smoothedSurplus: number; // Watt
  lastSurplusSamples: number[]; // per calcolo media mobile

  // Hysteresis & Timers
  secondsSinceLastChange: number;
  apiStatus: "ONLINE" | "OFFLINE";
  mqttStatus: "ONLINE" | "OFFLINE";
}
