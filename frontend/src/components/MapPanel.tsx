import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { useEffect, useRef, useState } from "react";
import type { MissionWaypoint, TelemetryState } from "../types/telemetry";

// Vite bundles Leaflet's default marker images under a hashed path that its
// built-in CSS doesn't know about — point the default icon at the imported
// URLs directly, once, for the whole app.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const HOME_FALLBACK: [number, number] = [-35.363261, 149.16523]; // SITL CMAC home

// Heading-pointing chevron, the same style GCS software like QGroundControl
// uses for the vehicle marker, instead of a plain dot. The wrapper div is
// rotated on each telemetry update (see the vehicle marker effect below);
// Leaflet owns the outer positioning transform on the icon element itself,
// so the rotation has to live on this separate inner element.
const vehicleIcon = L.divIcon({
  className: "vehicle-marker-icon",
  html:
    '<div class="vehicle-marker-rotate">' +
    '<svg width="38" height="38" viewBox="0 0 24 24">' +
    '<path d="M12 2 L20.5 20 L12 15.5 L3.5 20 Z" fill="#ff3b30"/>' +
    "</svg>" +
    "</div>",
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

// House-shaped, draggable "planned home" marker — only shown while placing
// a waypoint mission (see the effect below), so the operator can relocate
// the mission's home reference by dragging it, the same way QGroundControl's
// Plan view lets you drag its home marker. Deliberately smaller than the
// vehicle icon and given a higher z-index so it's never hidden underneath it
// if the two end up on the same spot on the map.
const homeIcon = L.divIcon({
  className: "leaflet-div-icon home-marker-icon",
  html:
    '<svg width="20" height="20" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="11" fill="#123a7a" stroke="#ffffff" stroke-width="1"/>' +
    '<path d="M12 6.5 L18 11.5 V17.5 H14 V13.5 H10 V17.5 H6 V11.5 Z" fill="#ffffff"/>' +
    "</svg>",
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

type WaypointMarkerKind = "planned" | "mission" | "current";

function waypointIcon(n: number, kind: WaypointMarkerKind): L.DivIcon {
  return L.divIcon({
    className: `waypoint-marker-icon waypoint-marker-${kind}`,
    html: `<div class="waypoint-marker-badge">${n}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export function MapPanel({
  telemetry,
  missionPlanningOn,
  plannedWaypoints,
  returnToHome,
  onMapClick,
}: {
  telemetry: TelemetryState | null;
  missionPlanningOn: boolean;
  plannedWaypoints: MissionWaypoint[];
  returnToHome: boolean;
  onMapClick: (point: { lat: number; lon: number }) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const homeMarkerRef = useRef<L.Marker | null>(null);
  const activeHomeMarkerRef = useRef<L.Marker | null>(null);
  const plannedLayerRef = useRef<L.LayerGroup | null>(null);
  const missionLayerRef = useRef<L.LayerGroup | null>(null);
  const traceLineRef = useRef<L.Polyline | null>(null);
  const tracePointsRef = useRef<[number, number][]>([]);
  const wasArmedRef = useRef(false);
  // Mirrors the draggable home marker's live position so the planned route
  // line (home -> waypoint 1 -> ...) can be redrawn reactively as it moves.
  const [homePosition, setHomePosition] = useState<{ lat: number; lon: number } | null>(null);
  // The click handler below is registered once, when the map is created, so
  // it closes over stale props on every re-render — read the live value via
  // a ref instead of depending on missionPlanningOn directly.
  const missionPlanningOnRef = useRef(missionPlanningOn);

  useEffect(() => {
    missionPlanningOnRef.current = missionPlanningOn;
  }, [missionPlanningOn]);

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
    plannedLayerRef.current = L.layerGroup().addTo(map);
    missionLayerRef.current = L.layerGroup().addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (missionPlanningOnRef.current) {
        onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
      }
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the vehicle's live position marker in sync with telemetry, rotate
  // it to point along the current heading, and pan the map to follow it
  // once it flies outside the current view (without fighting the
  // operator's own manual pan/zoom while it's still in view).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || telemetry?.lat == null || telemetry?.lon == null) return;
    const pos: [number, number] = [telemetry.lat, telemetry.lon];
    if (!vehicleMarkerRef.current) {
      vehicleMarkerRef.current = L.marker(pos, { icon: vehicleIcon, zIndexOffset: 1000 })
        .bindTooltip("Vehicle")
        .addTo(map);
      map.panTo(pos);
    } else {
      vehicleMarkerRef.current.setLatLng(pos);
      if (!map.getBounds().pad(-0.1).contains(pos)) {
        map.panTo(pos);
      }
    }
    const rotateEl = vehicleMarkerRef.current.getElement()?.querySelector<HTMLElement>(".vehicle-marker-rotate");
    if (rotateEl) rotateEl.style.transform = `rotate(${telemetry.heading ?? 0}deg)`;
  }, [telemetry?.lat, telemetry?.lon, telemetry?.heading]);

  // Red breadcrumb trace of where the vehicle has actually flown this
  // sortie. Resets on the disarmed -> armed transition so each flight gets
  // its own clean trace instead of accumulating across multiple sorties;
  // capped so an hours-long session doesn't grow the point list forever.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const armed = telemetry?.armed ?? false;
    if (armed && !wasArmedRef.current) {
      tracePointsRef.current = [];
      traceLineRef.current?.setLatLngs([]);
    }
    wasArmedRef.current = armed;
    if (telemetry?.lat == null || telemetry?.lon == null) return;
    const pos: [number, number] = [telemetry.lat, telemetry.lon];
    const last = tracePointsRef.current[tracePointsRef.current.length - 1];
    if (!last || last[0] !== pos[0] || last[1] !== pos[1]) {
      tracePointsRef.current.push(pos);
      if (tracePointsRef.current.length > 2000) tracePointsRef.current.shift();
    }
    if (!traceLineRef.current) {
      traceLineRef.current = L.polyline(tracePointsRef.current, { color: "#ff3b30", weight: 2, opacity: 0.85 }).addTo(map);
    } else {
      traceLineRef.current.setLatLngs(tracePointsRef.current);
    }
    // The planned/mission route lines get cleared and redrawn from scratch
    // whenever their waypoints change, which re-inserts them above
    // whatever was already on the map — keep the trace pinned on top of
    // that dashed route line instead of getting buried under it.
    traceLineRef.current.bringToFront();
  }, [telemetry?.lat, telemetry?.lon, telemetry?.armed]);

  // Draggable "planned home" marker, shown only while placing a waypoint
  // mission — starts at the vehicle's actual reported home position (or its
  // current location if home isn't known yet) and can be dragged to
  // relocate it. Only created once per planning session; dragging it is
  // never overwritten by a later telemetry update while planning is on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!missionPlanningOn) {
      homeMarkerRef.current?.remove();
      homeMarkerRef.current = null;
      setHomePosition(null);
      return;
    }
    if (homeMarkerRef.current) return;
    const initial: [number, number] =
      telemetry?.home_lat != null && telemetry?.home_lon != null
        ? [telemetry.home_lat, telemetry.home_lon]
        : telemetry?.lat != null && telemetry?.lon != null
          ? [telemetry.lat, telemetry.lon]
          : HOME_FALLBACK;
    const marker = L.marker(initial, { icon: homeIcon, draggable: true, zIndexOffset: 1100, autoPan: true }).addTo(map);
    marker.bindTooltip(`Home · ${initial[0].toFixed(5)}, ${initial[1].toFixed(5)}`);
    setHomePosition({ lat: initial[0], lon: initial[1] });
    marker.on("drag", () => {
      const pos = marker.getLatLng();
      marker.setTooltipContent(`Home · ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`);
      setHomePosition({ lat: pos.lat, lon: pos.lng });
    });
    homeMarkerRef.current = marker;
  }, [missionPlanningOn, telemetry?.home_lat, telemetry?.home_lon, telemetry?.lat, telemetry?.lon]);

  // Fixed (non-draggable) home marker shown once a mission is actually
  // uploaded and flying — the draggable planning marker above disappears
  // as soon as Start Mission succeeds, so without this there'd be no home
  // reference left on the map while the vehicle is away flying the route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const missionActive = telemetry?.mission_active ?? false;
    if (!missionActive || telemetry?.home_lat == null || telemetry?.home_lon == null) {
      activeHomeMarkerRef.current?.remove();
      activeHomeMarkerRef.current = null;
      return;
    }
    const pos: [number, number] = [telemetry.home_lat, telemetry.home_lon];
    if (!activeHomeMarkerRef.current) {
      activeHomeMarkerRef.current = L.marker(pos, { icon: homeIcon, zIndexOffset: 1100 }).bindTooltip("Home").addTo(map);
    } else {
      activeHomeMarkerRef.current.setLatLng(pos);
    }
  }, [telemetry?.mission_active, telemetry?.home_lat, telemetry?.home_lon]);

  // Waypoints the operator has placed but not sent yet — redrawn from
  // scratch on every change since the list is short and edits (add/remove)
  // don't have a stable per-marker identity worth diffing. The route line
  // starts at the draggable home marker (if it's currently placed) so
  // there's a visible home -> waypoint 1 -> ... segment while planning.
  useEffect(() => {
    const layer = plannedLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (plannedWaypoints.length === 0) return;
    const points: [number, number][] = [];
    if (homePosition) points.push([homePosition.lat, homePosition.lon]);
    plannedWaypoints.forEach((wp) => points.push([wp.lat, wp.lon]));
    if (returnToHome && homePosition) points.push([homePosition.lat, homePosition.lon]);
    if (points.length >= 2) {
      L.polyline(points, { color: "#4fc3f7", weight: 2, dashArray: "6 6" }).addTo(layer);
    }
    plannedWaypoints.forEach((wp, i) => {
      L.marker([wp.lat, wp.lon], { icon: waypointIcon(i + 1, "planned") })
        .bindTooltip(`Waypoint ${i + 1} · ${wp.altitude.toFixed(0)}m`)
        .addTo(layer);
    });
    // Redrawing this layer re-inserts its polyline above whatever was
    // already on the map, including the flight trace — pull the trace
    // back on top regardless of which effect happened to run last.
    traceLineRef.current?.bringToFront();
  }, [plannedWaypoints, homePosition, returnToHome]);

  // The route the backend actually uploaded and is flying (once a mission
  // is active) — the current target waypoint is highlighted distinctly, and
  // the line starts at the vehicle's actual home position.
  useEffect(() => {
    const layer = missionLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const waypoints = telemetry?.mission_waypoints;
    if (!waypoints || waypoints.length === 0) return;
    const home: [number, number] | null =
      telemetry?.home_lat != null && telemetry?.home_lon != null ? [telemetry.home_lat, telemetry.home_lon] : null;
    const points: [number, number][] = [];
    if (home) points.push(home);
    waypoints.forEach((wp) => points.push([wp.lat, wp.lon]));
    if (telemetry?.mission_return_to_home && home) points.push(home);
    L.polyline(points, { color: "#000000", weight: 2, dashArray: "6 6" }).addTo(layer);
    waypoints.forEach((wp, i) => {
      const isCurrent = telemetry?.mission_current_seq === i;
      L.marker([wp.lat, wp.lon], { icon: waypointIcon(i + 1, isCurrent ? "current" : "mission") })
        .bindTooltip(`Waypoint ${i + 1} · ${wp.altitude.toFixed(0)}m${isCurrent ? " · current target" : ""}`)
        .addTo(layer);
    });
    // Same reasoning as the planned-route effect above - keep the trace on
    // top of this freshly redrawn mission route line too.
    traceLineRef.current?.bringToFront();
  }, [
    telemetry?.mission_waypoints,
    telemetry?.mission_current_seq,
    telemetry?.home_lat,
    telemetry?.home_lon,
    telemetry?.mission_return_to_home,
  ]);

  const overlayValue = telemetry?.mission_active
    ? `Waypoint ${(telemetry.mission_current_seq ?? 0) + 1} / ${telemetry.mission_total ?? "?"} · AUTO`
    : plannedWaypoints.length > 0
      ? `${plannedWaypoints.length} waypoint(s) planned · not sent yet`
      : "No active mission";

  return (
    <div className="map-card">
      <div ref={mapContainerRef} className="main-map" />
      <div className="map-overlay-label">
        <div className="metric-label">Mission</div>
        <div className="map-overlay-value">{overlayValue}</div>
      </div>
    </div>
  );
}
