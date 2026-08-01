import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { useEffect, useRef, useState } from "react";
import { droneApi } from "../api/client";
import type { CommandResult, TelemetryState } from "../types/telemetry";

// Vite bundles Leaflet's default marker images under a hashed path that its
// built-in CSS doesn't know about — point the default icon at the imported
// URLs directly, once, for the whole app.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const HOME_FALLBACK: [number, number] = [-35.363261, 149.16523]; // SITL CMAC home
const pendingIcon = new L.Icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  className: "marker-pending",
});
const targetIcon = new L.Icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  className: "marker-target",
});

export function SearchPanel({
  telemetry,
  connected,
  onResult,
}: {
  telemetry: TelemetryState | null;
  connected: boolean;
  onResult: (result: CommandResult) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const vehicleMarkerRef = useRef<L.CircleMarker | null>(null);
  const pendingMarkerRef = useRef<L.Marker | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);

  const [searchModeOn, setSearchModeOn] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [searchAltitude, setSearchAltitude] = useState(15);
  const [busy, setBusy] = useState(false);

  const armed = telemetry?.armed ?? false;
  const canStartSearch = connected && armed && pendingPoint !== null && !busy;

  // Create the map once.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const center: [number, number] =
      telemetry?.lat != null && telemetry?.lon != null ? [telemetry.lat, telemetry.lon] : HOME_FALLBACK;
    const map = L.map(mapContainerRef.current).setView(center, 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      setSearchModeOn((on) => {
        if (on) setPendingPoint({ lat: e.latlng.lat, lon: e.latlng.lng });
        return on;
      });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the vehicle's live position marker in sync with telemetry, and pan
  // the map to follow it once it flies outside the current view (without
  // fighting the operator's own manual pan/zoom while it's still in view).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || telemetry?.lat == null || telemetry?.lon == null) return;
    const pos: [number, number] = [telemetry.lat, telemetry.lon];
    if (!vehicleMarkerRef.current) {
      vehicleMarkerRef.current = L.circleMarker(pos, {
        radius: 7,
        color: "#c15f3c",
        fillColor: "#c15f3c",
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip("Vehicle")
        .addTo(map);
      map.panTo(pos);
    } else {
      vehicleMarkerRef.current.setLatLng(pos);
      if (!map.getBounds().pad(-0.1).contains(pos)) {
        map.panTo(pos);
      }
    }
  }, [telemetry?.lat, telemetry?.lon]);

  // Marker for the point the operator just clicked but hasn't sent yet.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pendingPoint) {
      pendingMarkerRef.current?.remove();
      pendingMarkerRef.current = null;
      return;
    }
    const pos: [number, number] = [pendingPoint.lat, pendingPoint.lon];
    if (!pendingMarkerRef.current) {
      pendingMarkerRef.current = L.marker(pos, { icon: pendingIcon }).bindTooltip("Selected point").addTo(map);
    } else {
      pendingMarkerRef.current.setLatLng(pos);
    }
  }, [pendingPoint]);

  // Marker for the point the backend is actually flying to / holding at.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (telemetry?.search_target_lat == null || telemetry?.search_target_lon == null) {
      targetMarkerRef.current?.remove();
      targetMarkerRef.current = null;
      return;
    }
    const pos: [number, number] = [telemetry.search_target_lat, telemetry.search_target_lon];
    if (!targetMarkerRef.current) {
      targetMarkerRef.current = L.marker(pos, { icon: targetIcon }).bindTooltip("Search target").addTo(map);
    } else {
      targetMarkerRef.current.setLatLng(pos);
    }
  }, [telemetry?.search_target_lat, telemetry?.search_target_lon]);

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
        <p style={{ margin: "0 0 var(--space-3)", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Click a point on the map to select the search target. Starting a search takes off (if not already
          airborne) to the altitude set above, flies there, and holds position.
        </p>
      )}
      <div ref={mapContainerRef} className="search-map" />
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
