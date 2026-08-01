import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { droneApi } from "../api/client";
import type { CommandResult, TelemetryState } from "../types/telemetry";

type Point = { lat: number; lon: number };

export function SearchCommands({
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
  const canStartSearch = connected && armed && pendingPoint !== null && !busy;

  async function startSearch() {
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

  async function toggleSearchMode() {
    const turningOff = searchModeOn;
    setSearchModeOn((on) => !on);
    if (!turningOff) return;
    setPendingPoint(null);
    if (telemetry?.search_target_lat == null) return;
    setBusy(true);
    try {
      const result = await droneApi.cancelSearch();
      onResult(result);
    } finally {
      setBusy(false);
    }
  }

  const hasActiveTarget = telemetry?.search_target_lat != null;
  const statusText = hasActiveTarget ? (telemetry?.search_arrived ? "At search point" : "Heading to search point…") : null;

  return (
    <div className="card">
      <div className="section-title">Search area</div>
      <div className="command-panel" style={{ marginBottom: "var(--space-3)" }}>
        <button
          className={searchModeOn ? "btn btn-primary" : "btn"}
          disabled={(!connected || !armed) && !searchModeOn}
          onClick={toggleSearchMode}
        >
          {searchModeOn ? "Search Mode: On" : "Search Mode"}
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "0.875rem" }}>
          Altitude to search
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
        <button className="btn btn-primary" disabled={!canStartSearch} onClick={startSearch}>
          Start Search
        </button>
        {statusText && <StatusText text={statusText} />}
      </div>
      {searchModeOn && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Click a point on the map to select the search target. Starting a search takes off (if not already
          airborne) to the altitude set above, flies there, and holds position.
        </p>
      )}
    </div>
  );
}

function StatusText({ text }: { text: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: "0.8125rem",
        color: "var(--color-text-muted)",
        marginLeft: "var(--space-2)",
      }}
    >
      {text}
    </span>
  );
}
