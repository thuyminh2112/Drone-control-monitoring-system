import type { CommandResult, TelemetryState } from "../types/telemetry";

async function post(path: string, body?: unknown): Promise<CommandResult> {
  const res = await fetch(`/api/drone/${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    return { success: false, message: data.detail ?? "Request failed", mav_result: null };
  }
  return data as CommandResult;
}

export const droneApi = {
  arm: () => post("arm"),
  disarm: () => post("disarm"),
  takeoff: (altitude: number) => post("takeoff", { altitude }),
  rtl: () => post("rtl"),
  search: (lat: number, lon: number, altitude: number) => post("search", { lat, lon, altitude }),
  cancelSearch: () => post("search/cancel"),
  getState: async (): Promise<TelemetryState> => {
    const res = await fetch("/api/drone/state");
    return res.json();
  },
};
