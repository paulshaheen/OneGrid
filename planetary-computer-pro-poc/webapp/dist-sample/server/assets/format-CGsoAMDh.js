//#region src/lib/format.ts
var ASSET_TYPE_LABEL = {
	offshore_platform: "Offshore platform",
	pipeline: "Pipeline",
	well: "Well",
	refinery: "Refinery",
	lng_terminal: "LNG terminal",
	storage: "Storage facility",
	port: "Port / logistics base"
};
var STATUS_LABEL = {
	producing: "Producing",
	reduced: "Reduced rate",
	shut_in: "Shut in",
	evacuating: "Evacuating",
	standby: "Standby"
};
var RISK_LABEL = {
	normal: "Normal",
	monitor: "Monitor",
	elevated: "Elevated",
	high: "High",
	critical: "Critical"
};
var RISK_ORDER = [
	"critical",
	"high",
	"elevated",
	"monitor",
	"normal"
];
function riskColorVar(level) {
	return `var(--risk-${level})`;
}
function coords(lat, lon) {
	const ns = lat >= 0 ? "N" : "S";
	const ew = lon >= 0 ? "E" : "W";
	return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}
function relativeTime(iso) {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.round(diff / 6e4);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins} min ago`;
	const hrs = Math.round(mins / 60);
	if (hrs < 24) return `${hrs} h ago`;
	return `${Math.round(hrs / 24)} d ago`;
}
function utcStamp(iso) {
	return `${new Date(iso).toISOString().slice(11, 16)} UTC`;
}
//#endregion
export { coords as a, utcStamp as c, STATUS_LABEL as i, RISK_LABEL as n, relativeTime as o, RISK_ORDER as r, riskColorVar as s, ASSET_TYPE_LABEL as t };
