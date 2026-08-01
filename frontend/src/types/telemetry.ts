export interface TelemetryState {
  connected: boolean;
  armed: boolean;
  flight_mode: string;

  battery_percent: number | null;
  battery_voltage: number | null;

  lat: number | null;
  lon: number | null;
  alt_relative: number | null;
  alt_msl: number | null;

  groundspeed: number | null;
  heading: number | null;

  last_heartbeat: string | null;
  timestamp: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  mav_result: string | null;
}

export type WsStatus = "connecting" | "open" | "closed";
