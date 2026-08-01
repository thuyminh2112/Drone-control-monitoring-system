import type { TelemetryState, WsStatus } from "../types/telemetry";
import { AltitudePanel } from "./AltitudePanel";
import { ArmedIndicator } from "./ArmedIndicator";
import { BatteryGauge } from "./BatteryGauge";
import { FlightModeBadge } from "./FlightModeBadge";
import { GpsPanel } from "./GpsPanel";
import { StatusBadge } from "./StatusBadge";

export function FlightStatePanel({ telemetry, wsStatus }: { telemetry: TelemetryState | null; wsStatus: WsStatus }) {
  const connected = telemetry?.connected ?? false;
  const tone = wsStatus !== "open" ? "warn" : connected ? "good" : "bad";
  const label = wsStatus !== "open" ? "Link reconnecting…" : connected ? "Connected" : "Disconnected";

  return (
    <div className="flight-state-panel">
      <div className="section-title">Flight state</div>
      <div className="card">
        <div className="metric-label">Connection</div>
        <StatusBadge tone={tone} label={label} />
      </div>
      <BatteryGauge percent={telemetry?.battery_percent ?? null} voltage={telemetry?.battery_voltage ?? null} />
      <AltitudePanel altRelative={telemetry?.alt_relative ?? null} groundspeed={telemetry?.groundspeed ?? null} />
      <GpsPanel lat={telemetry?.lat ?? null} lon={telemetry?.lon ?? null} />
      <FlightModeBadge mode={telemetry?.flight_mode ?? "UNKNOWN"} />
      <ArmedIndicator armed={telemetry?.armed ?? false} />
    </div>
  );
}
