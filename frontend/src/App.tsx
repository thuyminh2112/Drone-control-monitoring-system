import { useEffect, useState } from "react";
import { AltitudePanel } from "./components/AltitudePanel";
import { ArmedIndicator } from "./components/ArmedIndicator";
import { BatteryGauge } from "./components/BatteryGauge";
import { CommandPanel } from "./components/CommandPanel";
import { FlightModeBadge } from "./components/FlightModeBadge";
import { GpsPanel } from "./components/GpsPanel";
import { Header } from "./components/Header";
import { useTelemetry } from "./hooks/useTelemetry";
import type { CommandResult } from "./types/telemetry";

export default function App() {
  const { telemetry, status } = useTelemetry();
  const [toast, setToast] = useState<CommandResult | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const connected = telemetry?.connected ?? false;

  return (
    <div className="app-shell">
      <Header connected={connected} wsStatus={status} />

      <div className="grid">
        <BatteryGauge percent={telemetry?.battery_percent ?? null} voltage={telemetry?.battery_voltage ?? null} />
        <AltitudePanel altRelative={telemetry?.alt_relative ?? null} groundspeed={telemetry?.groundspeed ?? null} />
        <GpsPanel lat={telemetry?.lat ?? null} lon={telemetry?.lon ?? null} />
        <FlightModeBadge mode={telemetry?.flight_mode ?? "UNKNOWN"} />
        <ArmedIndicator armed={telemetry?.armed ?? false} />
      </div>

      <CommandPanel telemetry={telemetry} connected={connected} onResult={setToast} />

      {toast && <div className={`toast ${toast.success ? "" : "error"}`}>{toast.message}</div>}
    </div>
  );
}
