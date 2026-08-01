import { useState } from "react";
import { droneApi } from "../api/client";
import type { CommandResult, TelemetryState } from "../types/telemetry";
import { ConfirmDialog } from "./ConfirmDialog";

type PendingAction = "disarm" | "land" | "rtl" | null;

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
  const [pending, setPending] = useState<PendingAction>(null);
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
      setPending(null);
    }
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
          onClick={() => (inAir ? setPending("disarm") : run(droneApi.disarm))}
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
          onClick={() => setPending("land")}
        >
          Land
        </button>
        <button
          className={flightMode === "RTL" ? "btn btn-active command-grid-span2" : "btn btn-danger command-grid-span2"}
          disabled={!connected || !armed || busy}
          onClick={() => setPending("rtl")}
        >
          RTL
        </button>
      </div>

      {pending === "disarm" && (
        <ConfirmDialog
          title="Disarm while airborne?"
          description="The vehicle appears to be in flight. Disarming now will cut the motors immediately and it will fall."
          confirmLabel="Disarm anyway"
          danger
          onConfirm={() => run(droneApi.disarm)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending === "land" && (
        <ConfirmDialog
          title="Land now?"
          description="The vehicle will switch to LAND mode and descend straight down at its current position. ArduCopter sets the launch point to wherever the vehicle was armed, so if it hasn't moved since arming, this is the same as Return to Launch — the two only diverge once it has flown away from that point."
          confirmLabel="Land"
          onConfirm={() => run(droneApi.land)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending === "rtl" && (
        <ConfirmDialog
          title="Return to launch?"
          description="The vehicle will abort the current sortie and autonomously fly back to the home position to land."
          confirmLabel="Return to launch"
          danger
          onConfirm={() => run(droneApi.rtl)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
