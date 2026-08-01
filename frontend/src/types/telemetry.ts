export interface MissionWaypoint {
  lat: number;
  lon: number;
  altitude: number;
}

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
  vertical_speed: number | null;

  home_lat: number | null;
  home_lon: number | null;

  roll: number | null;
  pitch: number | null;
  yaw: number | null;

  search_target_lat: number | null;
  search_target_lon: number | null;
  search_arrived: boolean;

  mission_active: boolean;
  mission_waypoints: MissionWaypoint[] | null;
  mission_current_seq: number | null;
  mission_total: number | null;
  mission_return_to_home: boolean;

  last_heartbeat: string | null;
  timestamp: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  mav_result: string | null;
}

export type WsStatus = "connecting" | "open" | "closed";
