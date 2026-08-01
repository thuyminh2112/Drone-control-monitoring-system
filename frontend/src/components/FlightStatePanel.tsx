import { useEffect, useRef, useState } from "react";
import type { TelemetryState, WsStatus } from "../types/telemetry";
import { StatusBadge } from "./StatusBadge";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

// Fill bar width scales with the actual charge level (not just a fixed
// full-looking bar recolored by threshold), so the icon reads correctly at
// a glance even before the percentage text registers.
function BatteryIcon({ percent, color }: { percent: number | null; color: string }) {
  const pct = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const fillWidth = (pct / 100) * 12;
  return (
    <svg className="battery-icon" width="20" height="12" viewBox="0 0 20 12" fill="none">
      <rect x="0.5" y="0.5" width="16" height="11" rx="1.5" stroke={color} />
      <rect x="17.5" y="4" width="2" height="4" rx="0.5" fill={color} />
      <rect x="2" y="2" width="12" height="8" rx="0.5" fill="none" stroke={color} strokeOpacity="0.3" />
      {fillWidth > 0 && <rect x="2" y="2" width={fillWidth} height="8" rx="0.5" fill={color} />}
    </svg>
  );
}

// Consolidated "Flight state" sidebar section: the top three-across status
// strip (flight mode / arming / connection) plus one telemetry card with all
// numeric readouts, matching a single-glance GCS instrument layout.
export function FlightStatePanel({ telemetry, wsStatus }: { telemetry: TelemetryState | null; wsStatus: WsStatus }) {
  const connected = telemetry?.connected ?? false;
  const armed = telemetry?.armed ?? false;
  const linkTone = wsStatus !== "open" ? "warn" : connected ? "good" : "bad";
  const linkLabel = wsStatus !== "open" ? "Link reconnecting…" : connected ? "Vehicle connected" : "Vehicle disconnected";

  const [now, setNow] = useState(() => new Date());
  const armedSinceRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Live clock, ticks once a second regardless of vehicle state.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Flight timer: starts counting from the moment the vehicle arms, resets
  // when it disarms. Computed purely client-side from the armed transition
  // - the backend doesn't need to track this itself.
  useEffect(() => {
    if (armed && armedSinceRef.current == null) {
      armedSinceRef.current = Date.now();
    } else if (!armed) {
      armedSinceRef.current = null;
      setElapsedSeconds(0);
    }
  }, [armed]);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsedSeconds(armedSinceRef.current != null ? Math.floor((Date.now() - armedSinceRef.current) / 1000) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const battery = telemetry?.battery_percent ?? null;
  const batteryColor = battery == null ? "var(--color-text-muted)" : battery > 30 ? "var(--color-good)" : battery > 15 ? "var(--color-warn)" : "var(--color-bad)";
  const groundspeedKmh = telemetry?.groundspeed != null ? telemetry.groundspeed * 3.6 : null;

  return (
    <div className="flight-state-panel">
      <div className="card status-bar">
        <div className="status-bar-item">
          <div className="metric-label">Flight mode</div>
          <span className="mode-badge">{telemetry?.flight_mode ?? "UNKNOWN"}</span>
        </div>
        <div className="status-bar-item">
          <div className="metric-label">Arming status</div>
          <StatusBadge tone={armed ? "good" : "bad"} label={armed ? "Armed" : "Disarmed"} />
        </div>
        <div className="status-bar-item">
          <div className="metric-label">Vehicle</div>
          <StatusBadge tone={linkTone} label={linkLabel} />
        </div>
      </div>

      <div className="card">
        <div className="section-title">Telemetry</div>
        <div className="telemetry-grid">
          <div>
            <div className="metric-label">Battery</div>
            <div className="metric-value" style={{ color: batteryColor }}>
              <BatteryIcon percent={battery} color={batteryColor} />
              {battery == null ? "—" : `${battery.toFixed(0)}%`}
            </div>
            {telemetry?.battery_voltage != null && (
              <div className="telemetry-subvalue">{telemetry.battery_voltage.toFixed(2)} V</div>
            )}
          </div>
          <div>
            <div className="metric-label">Altitude (AGL)</div>
            <div className="metric-value metric-value-info">
              {telemetry?.alt_relative != null ? `${telemetry.alt_relative.toFixed(1)} m` : "—"}
            </div>
            <div className="telemetry-subvalue">vertical speed —</div>
          </div>

          <div>
            <div className="metric-label">Ground speed</div>
            <div className="metric-value">{groundspeedKmh != null ? `${groundspeedKmh.toFixed(1)} km/h` : "—"}</div>
          </div>
          <div>
            <div className="metric-label">Flight time</div>
            <div className="metric-value">{formatElapsed(elapsedSeconds)}</div>
          </div>

          <div>
            <div className="metric-label">Position — lat</div>
            <div className="metric-value small">{telemetry?.lat != null ? telemetry.lat.toFixed(6) : "—"}</div>
          </div>
          <div>
            <div className="metric-label">Position — lon</div>
            <div className="metric-value small">{telemetry?.lon != null ? telemetry.lon.toFixed(6) : "—"}</div>
          </div>

          <div>
            <div className="metric-label">Current time</div>
            <div className="metric-value small">{formatClock(now)}</div>
          </div>
          <div>
            <div className="metric-label">Date &amp; location</div>
            <div className="metric-value small">{formatDate(now)}</div>
            <div className="telemetry-subvalue">Jerrabomberra, Australia</div>
          </div>

          <hr className="telemetry-divider" />

          <div className="attitude-row">
            <div>
              <div className="metric-label">Roll</div>
              <div className="metric-value">—</div>
            </div>
            <div>
              <div className="metric-label">Pitch</div>
              <div className="metric-value">—</div>
            </div>
            <div>
              <div className="metric-label">Yaw</div>
              <div className="metric-value">{telemetry?.heading != null ? `${telemetry.heading.toFixed(0)}°` : "—"}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
