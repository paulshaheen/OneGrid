import type { AssetType, OperatingStatus, RiskLevel } from "@/lib/domain/types";

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  offshore_platform: "Offshore platform",
  pipeline: "Pipeline",
  well: "Well",
  refinery: "Refinery",
  lng_terminal: "LNG terminal",
  storage: "Storage facility",
  port: "Port / logistics base",
};

export const STATUS_LABEL: Record<OperatingStatus, string> = {
  producing: "Producing",
  reduced: "Reduced rate",
  shut_in: "Shut in",
  evacuating: "Evacuating",
  standby: "Standby",
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  normal: "Normal",
  monitor: "Monitor",
  elevated: "Elevated",
  high: "High",
  critical: "Critical",
};

export const RISK_ORDER: RiskLevel[] = ["critical", "high", "elevated", "monitor", "normal"];

export function riskColorVar(level: RiskLevel): string {
  return `var(--risk-${level})`;
}

export function coords(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function utcStamp(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 16)} UTC`;
}
