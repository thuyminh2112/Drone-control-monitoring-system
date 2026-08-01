import { useEffect, useState } from "react";
import { CommandPanel } from "./components/CommandPanel";
import { CompassWidget } from "./components/CompassWidget";
import { FlightStatePanel } from "./components/FlightStatePanel";
import { Header } from "./components/Header";
import { MapPanel } from "./components/MapPanel";
import { SearchCommands } from "./components/SearchCommands";
import { useTelemetry } from "./hooks/useTelemetry";
import type { CommandResult } from "./types/telemetry";

export default function App() {
  const { telemetry, status } = useTelemetry();
  const [toast, setToast] = useState<CommandResult | null>(null);
  const [searchModeOn, setSearchModeOn] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const connected = telemetry?.connected ?? false;

  return (
    <div className="app-shell">
      <Header />

      <div className="main-layout">
        <div className="left-column">
          <MapPanel
            telemetry={telemetry}
            searchModeOn={searchModeOn}
            pendingPoint={pendingPoint}
            onMapClick={setPendingPoint}
          />
          <CommandPanel telemetry={telemetry} connected={connected} onResult={setToast} />
          <SearchCommands
            telemetry={telemetry}
            connected={connected}
            searchModeOn={searchModeOn}
            setSearchModeOn={setSearchModeOn}
            pendingPoint={pendingPoint}
            setPendingPoint={setPendingPoint}
            onResult={setToast}
          />
        </div>

        <div className="right-column">
          <FlightStatePanel telemetry={telemetry} wsStatus={status} />
          <div className="card compass-card">
            <div className="section-title">Compass</div>
            <CompassWidget heading={telemetry?.heading ?? null} size={168} standalone />
          </div>
        </div>
      </div>

      {toast && <div className={`toast ${toast.success ? "" : "error"}`}>{toast.message}</div>}
    </div>
  );
}
