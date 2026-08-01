import { useEffect, useState } from "react";
import { CommandPanel } from "./components/CommandPanel";
import { CompassWidget } from "./components/CompassWidget";
import { FlightStatePanel } from "./components/FlightStatePanel";
import { Header } from "./components/Header";
import { MapPanel } from "./components/MapPanel";
import { MissionPlanCard } from "./components/MissionPlanCard";
import { VehicleCard } from "./components/VehicleCard";
import { useTelemetry } from "./hooks/useTelemetry";
import type { CommandResult, MissionWaypoint } from "./types/telemetry";

const DEFAULT_WAYPOINT_ALTITUDE = 15;

export default function App() {
  const { telemetry, status } = useTelemetry();
  const [toast, setToast] = useState<CommandResult | null>(null);
  const [missionPlanningOn, setMissionPlanningOn] = useState(false);
  const [plannedWaypoints, setPlannedWaypoints] = useState<MissionWaypoint[]>([]);
  const [missionAltitude, setMissionAltitude] = useState(DEFAULT_WAYPOINT_ALTITUDE);
  const [returnToHome, setReturnToHome] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const connected = telemetry?.connected ?? false;

  function handleMapClick(point: { lat: number; lon: number }) {
    setPlannedWaypoints((wps) => [...wps, { ...point, altitude: missionAltitude }]);
  }

  return (
    <div className="app-shell">
      <Header />

      <div className="main-layout">
        <div className="left-column">
          <MapPanel
            telemetry={telemetry}
            missionPlanningOn={missionPlanningOn}
            plannedWaypoints={plannedWaypoints}
            returnToHome={returnToHome}
            onMapClick={handleMapClick}
          />
        </div>

        <div className="right-column">
          <FlightStatePanel telemetry={telemetry} wsStatus={status} />

          <CommandPanel telemetry={telemetry} connected={connected} onResult={setToast} />

          <MissionPlanCard
            telemetry={telemetry}
            connected={connected}
            missionPlanningOn={missionPlanningOn}
            setMissionPlanningOn={setMissionPlanningOn}
            plannedWaypoints={plannedWaypoints}
            setPlannedWaypoints={setPlannedWaypoints}
            missionAltitude={missionAltitude}
            setMissionAltitude={setMissionAltitude}
            returnToHome={returnToHome}
            setReturnToHome={setReturnToHome}
            onResult={setToast}
          />

          <div className="compass-vehicle-row">
            <div className="card compass-card">
              <CompassWidget heading={telemetry?.heading ?? null} size={101} standalone />
            </div>
            <VehicleCard iconSize={61} />
          </div>
        </div>
      </div>

      {toast && <div className={`toast ${toast.success ? "" : "error"}`}>{toast.message}</div>}
    </div>
  );
}
