import { useState } from "react";
import { droneApi } from "../api/client";
import type { CommandResult, TelemetryState } from "../types/telemetry";
import { ConfirmDialog } from "./ConfirmDialog";

type PendingAction = "disarm" | "takeoff" | "land" | "rtl" | null;

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
  const [altitude, setAltitude] = useState(10);

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
          className="btn btn-arm"
          disabled={!connected || armed || busy}
          onClick={() => run(droneApi.arm)}
        >
          Arm
        </button>
        <button
          className="btn btn-danger"
          disabled={!connected || !armed || busy}
          onClick={() => (inAir ? setPending("disarm") : run(droneApi.disarm))}
        >
          Disarm
        </button>
        <button className="btn" disabled={!connected || !armed || busy} onClick={() => setPending("takeoff")}>
          Takeoff
        </button>
        <button
          className={flightMode === "LAND" ? "btn btn-active" : "btn"}
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
          Return to Launch
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

      {pending === "takeoff" && (
        <ConfirmDialog
          title="Confirm takeoff"
          description="The vehicle will switch to GUIDED mode and climb to the target altitude."
          confirmLabel="Takeoff"
          onConfirm={() => run(() => droneApi.takeoff(altitude))}
          onCancel={() => setPending(null)}
        >
          <label style={{ display: "block", fontSize: "0.8125rem", color: "var(--color-text-muted)", marginBottom: 4 }}>
            Target altitude (meters)
          </label>
          <input
            className="dialog-input"
            type="number"
            min={1}
            max={120}
            value={altitude}
            onChange={(e) => setAltitude(Number(e.target.value))}
          />
        </ConfirmDialog>
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
