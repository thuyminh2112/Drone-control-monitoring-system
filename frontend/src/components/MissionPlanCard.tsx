import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { droneApi } from "../api/client";
import type { CommandResult, MissionWaypoint, TelemetryState } from "../types/telemetry";

// "Mission Plan" list, matching the reference layout. Only "Waypoint
// Mission" is real today: it's a QGroundControl-style multi-waypoint AUTO
// mission — click points on the map in the order the vehicle should fly
// them, each carrying its own altitude, then "Start Mission" uploads the
// whole route via the MAVLink mission protocol and the vehicle flies it
// autonomously in AUTO mode (auto-taking off first if it's on the ground).
// Grid Survey / Orbit & Loiter are shown for the target layout but
// intentionally disabled - there's no backend support for them yet, and a
// clickable button that does nothing would be worse than an honest
// "coming soon" state.
export function MissionPlanCard({
  telemetry,
  connected,
  missionPlanningOn,
  setMissionPlanningOn,
  plannedWaypoints,
  setPlannedWaypoints,
  missionAltitude,
  setMissionAltitude,
  returnToHome,
  setReturnToHome,
  onResult,
}: {
  telemetry: TelemetryState | null;
  connected: boolean;
  missionPlanningOn: boolean;
  setMissionPlanningOn: Dispatch<SetStateAction<boolean>>;
  plannedWaypoints: MissionWaypoint[];
  setPlannedWaypoints: Dispatch<SetStateAction<MissionWaypoint[]>>;
  missionAltitude: number;
  setMissionAltitude: Dispatch<SetStateAction<number>>;
  returnToHome: boolean;
  setReturnToHome: Dispatch<SetStateAction<boolean>>;
  onResult: (result: CommandResult) => void;
}) {
  const [busy, setBusy] = useState(false);

  const armed = telemetry?.armed ?? false;
  const missionActive = telemetry?.mission_active ?? false;
  const waypointItemActive = missionPlanningOn || missionActive;
  const canStartMission = connected && armed && plannedWaypoints.length > 0 && !busy && !missionActive;

  async function toggleWaypointMission() {
    if (missionActive) {
      setBusy(true);
      try {
        const result = await droneApi.cancelMission();
        onResult(result);
      } finally {
        setBusy(false);
        setMissionPlanningOn(false);
        setPlannedWaypoints([]);
      }
      return;
    }
    setMissionPlanningOn((on) => !on);
  }

  function removeWaypoint(index: number) {
    setPlannedWaypoints((wps) => wps.filter((_, i) => i !== index));
  }

  function clearWaypoints() {
    setPlannedWaypoints([]);
  }

  async function startMission() {
    if (plannedWaypoints.length === 0) return;
    const ok = window.confirm(
      `Start mission with ${plannedWaypoints.length} waypoint(s)?\n\nThe vehicle will take off automatically (if on the ground) and fly the planned route in AUTO mode.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const result = await droneApi.startMission(plannedWaypoints, returnToHome);
      onResult(result);
      if (result.success) {
        setPlannedWaypoints([]);
        setMissionPlanningOn(false);
        setReturnToHome(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const statusText = missionActive
    ? `Waypoint ${(telemetry?.mission_current_seq ?? 0) + 1} of ${telemetry?.mission_total ?? "?"} · AUTO`
    : null;

  return (
    <div className="card">
      <div className="section-title">Mission plan</div>
      <div className="mission-list">
        <button
          type="button"
          className={waypointItemActive ? "mission-item active" : "mission-item"}
          disabled={!connected || busy}
          onClick={toggleWaypointMission}
        >
          <span>Waypoint Mission</span>
          <span className={waypointItemActive ? "mission-item-tag active-tag" : "mission-item-tag soon-tag"}>
            {missionActive ? "Active" : missionPlanningOn ? "Planning" : "Ready"}
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

      {missionActive && statusText && (
        <p style={{ margin: "0 0 var(--space-3)", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          {statusText}
        </p>
      )}

      {missionPlanningOn && !missionActive && (
        <>
          <p style={{ margin: "0 0 var(--space-3)", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Click points on the map in flight order. Each new point uses the altitude below.
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
                value={missionAltitude}
                onChange={(e) => setMissionAltitude(Number(e.target.value))}
              />
              m
            </label>
            {plannedWaypoints.length > 0 && (
              <button type="button" className="btn" style={{ padding: "4px 10px", fontSize: "0.8125rem" }} onClick={clearWaypoints}>
                Clear
              </button>
            )}
            <button
              type="button"
              className={returnToHome ? "btn btn-active" : "btn"}
              style={{
                padding: "4px 10px",
                fontSize: "0.8125rem",
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
              onClick={() => setReturnToHome((v) => !v)}
              title="Add a final leg back to the home position"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 11.5 L12 3 L21 11.5 V21 H14 V14 H10 V21 H3 Z" fill="currentColor" />
              </svg>
              Return to Home
            </button>
          </div>

          {plannedWaypoints.length > 0 && (
            <ul className="waypoint-list">
              {plannedWaypoints.map((wp, i) => (
                <li key={i} className="waypoint-list-item">
                  <span className="waypoint-list-index">{i + 1}</span>
                  <span className="waypoint-list-coords">
                    {wp.lat.toFixed(5)}, {wp.lon.toFixed(5)}
                  </span>
                  <span className="waypoint-list-alt">{wp.altitude.toFixed(0)}m</span>
                  <button
                    type="button"
                    className="waypoint-list-remove"
                    aria-label={`Remove waypoint ${i + 1}`}
                    onClick={() => removeWaypoint(i)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <button className="btn btn-success btn-full" disabled={!canStartMission} onClick={startMission}>
        Start Mission
      </button>
    </div>
  );
}
