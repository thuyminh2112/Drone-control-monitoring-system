import { useState } from "react";
import { droneApi } from "../api/client";
import type { CommandResult, TelemetryState } from "../types/telemetry";
import { ConfirmDialog } from "./ConfirmDialog";

const DEFAULT_TAKEOFF_ALTITUDE = 10;

export function CommandPanel({
  telemetry,
  connected,
  onResult,
}: {
  telemetry: TelemetryState | null;
  connected: boolean;
  onResult: (result: CommandResult) => void;
}) {
  const [confirmingDisarm, setConfirmingDisarm] = useState(false);
  const [busy, setBusy] = useState(false);

  const armed = telemetry?.armed ?? false;
  const inAir = armed && (telemetry?.alt_relative ?? 0) > 0.5;
  const flightMode = telemetry?.flight_mode ?? "";

  async function run(fn: () => Promise<CommandResult>) {
    setBusy(true);
    try {
      const result = await fn();
      onResult(result);
    } finally {
      setBusy(false);
      setConfirmingDisarm(false);
    }
  }

  // Land/RTL use the browser's own native confirm() instead of the custom
  // dialog component - it's a synchronous, blocking call with no CSS,
  // z-index, or React state of its own, so there's no custom rendering
  // layer that can silently fail to show up.
  function handleLandClick() {
    const ok = window.confirm(
      "Land now?\n\nThe vehicle will switch to LAND mode and descend straight down at its current position.",
    );
    if (ok) run(droneApi.land);
  }

  function handleRtlClick() {
    const ok = window.confirm(
      "Return to launch?\n\nThe vehicle will abort the current sortie and autonomously fly back to the home position to land.",
    );
    if (ok) run(droneApi.rtl);
  }

  return (
    <div className="card">
      <div className="section-title">Commands</div>
      <div className="command-grid">
        <button
          className="btn btn-arm command-grid-span3"
          disabled={!connected || armed || busy}
          onClick={() => run(droneApi.arm)}
        >
          Arm
        </button>
        <button
          className="btn btn-danger command-grid-span3"
          disabled={!connected || !armed || busy}
          onClick={() => (inAir ? setConfirmingDisarm(true) : run(droneApi.disarm))}
        >
          Disarm
        </button>
        <button
          className="btn command-grid-span2"
          disabled={!connected || !armed || busy}
          onClick={() => run(() => droneApi.takeoff(DEFAULT_TAKEOFF_ALTITUDE))}
        >
          Takeoff
        </button>
        <button
          className={flightMode === "LAND" ? "btn btn-active command-grid-span2" : "btn command-grid-span2"}
          disabled={!connected || !armed || busy}
          onClick={handleLandClick}
        >
          Land
        </button>
        <button
          className={flightMode === "RTL" ? "btn btn-active command-grid-span2" : "btn btn-danger command-grid-span2"}
          disabled={!connected || !armed || busy}
          onClick={handleRtlClick}
        >
          RTL
        </button>
      </div>

      {confirmingDisarm && (
        <ConfirmDialog
          title="Disarm while airborne?"
          description="The vehicle appears to be in flight. Disarming now will cut the motors immediately and it will fall."
          confirmLabel="Disarm anyway"
          danger
          onConfirm={() => run(droneApi.disarm)}
          onCancel={() => setConfirmingDisarm(false)}
        />
      )}
    </div>
  );
}
