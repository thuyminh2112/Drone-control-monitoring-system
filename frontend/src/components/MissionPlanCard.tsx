import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { droneApi } from "../api/client";
import type { CommandResult, TelemetryState } from "../types/telemetry";

type Point = { lat: number; lon: number };

// "Mission Plan" list, matching the reference layout. Only "Waypoint
// Mission" is real today: selecting it is exactly the existing "Search
// Mode" toggle (click a map point, fly there, hold position), just
// presented as a mission-profile list instead of a standalone toggle
// button. Grid Survey / Orbit & Loiter are shown for the target layout but
// intentionally disabled - there's no backend support for them yet, and a
// clickable button that does nothing would be worse than an honest
// "coming soon" state.
export function MissionPlanCard({
  telemetry,
  connected,
  searchModeOn,
  setSearchModeOn,
  pendingPoint,
  setPendingPoint,
  onResult,
}: {
  telemetry: TelemetryState | null;
  connected: boolean;
  searchModeOn: boolean;
  setSearchModeOn: Dispatch<SetStateAction<boolean>>;
  pendingPoint: Point | null;
  setPendingPoint: Dispatch<SetStateAction<Point | null>>;
  onResult: (result: CommandResult) => void;
}) {
  const [searchAltitude, setSearchAltitude] = useState(15);
  const [busy, setBusy] = useState(false);

  const armed = telemetry?.armed ?? false;
  const hasActiveTarget = telemetry?.search_target_lat != null;
  const waypointActive = searchModeOn || hasActiveTarget;
  const canStartMission = connected && armed && pendingPoint !== null && !busy;

  async function toggleWaypointMission() {
    const turningOff = searchModeOn;
    setSearchModeOn((on) => !on);
    if (!turningOff) return;
    setPendingPoint(null);
    if (!hasActiveTarget) return;
    setBusy(true);
    try {
      const result = await droneApi.cancelSearch();
      onResult(result);
    } finally {
      setBusy(false);
    }
  }

  async function startMission() {
    if (!pendingPoint) return;
    setBusy(true);
    try {
      const result = await droneApi.search(pendingPoint.lat, pendingPoint.lon, searchAltitude);
      onResult(result);
      if (result.success) setPendingPoint(null);
    } finally {
      setBusy(false);
    }
  }

  const statusText = hasActiveTarget ? (telemetry?.search_arrived ? "At mission point" : "En route to mission point…") : null;

  return (
    <div className="card">
      <div className="section-title">Mission plan</div>
      <div className="mission-list">
        <button
          type="button"
          className={waypointActive ? "mission-item active" : "mission-item"}
          disabled={!connected || !armed}
          onClick={toggleWaypointMission}
        >
          <span>Waypoint Mission</span>
          <span className={waypointActive ? "mission-item-tag active-tag" : "mission-item-tag soon-tag"}>
            {waypointActive ? "Active" : "Ready"}
          </span>
        </button>
        <div className="mission-item mission-item-disabled">
          <span>Grid Survey</span>
          <span className="mission-item-tag soon-tag">Coming soon</span>
        </div>
        <div className="mission-item mission-item-disabled">
          <span>Orbit / Loiter</span>
          <span className="mission-item-tag soon-tag">Coming soon</span>
        </div>
      </div>

      {searchModeOn && (
        <>
          <p style={{ margin: "0 0 var(--space-3)", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Click a point on the map to set the mission target.
          </p>
          <div className="command-panel" style={{ marginBottom: "var(--space-3)" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "0.875rem" }}>
              Altitude
              <input
                className="dialog-input"
                style={{ width: 72, margin: 0 }}
                type="number"
                min={2}
                max={120}
                value={searchAltitude}
                onChange={(e) => setSearchAltitude(Number(e.target.value))}
              />
              m
            </label>
            {statusText && (
              <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>{statusText}</span>
            )}
          </div>
        </>
      )}

      <button className="btn btn-success btn-full" disabled={!canStartMission} onClick={startMission}>
        Start Mission
      </button>
    </div>
  );
}
