/* 네이버 스포츠 비공식 API 수집기 — 2026-07-18 실제 응답 구조 기준으로 작성/검증 */
import { computeBatter, computePitcher } from "./compute.mjs";

const BASE = "https://api-gw.sports.naver.com";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; MorningBall/1.0)", "Referer": "https://sports.naver.com" };

export const TEAMCODE = {
  lg: "LG", ob: "OB", ssg: "SK", kia: "HT", ss: "SS",
  kt: "KT", nc: "NC", lt: "LT", hh: "HH", wo: "WO"
};
export const NAVER2CODE = Object.fromEntries(Object.entries(TEAMCODE).map(([k, v]) => [v, k]));

async function getJson(url, timeoutMs = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function getGames(dateStr) {
  const url = `${BASE}/schedule/games?fields=basic,schedule,baseball&upperCategoryId=kbaseball&categoryId=kbo&fromDate=${dateStr}&toDate=${dateStr}&size=50`;
  const j = await getJson(url);
  const games = j?.result?.games;
  if (!Array.isArray(games)) throw new Error("games 필드 없음 — API 구조 변경 의심");
  return games;
}

/* homeTeamCode/awayTeamCode는 이미 실제 홈/원정 (reversedHomeAway는 UI 표시용 플래그) */
export function findGame(games, naverCode) {
  return games.find(g =>
    (g.homeTeamCode === naverCode || g.awayTeamCode === naverCode) && g.cancel !== true
  ) || null;
}
export function isHome(game, naverCode) { return game.homeTeamCode === naverCode; }

export async function getPreview(gameId) {
  const j = await getJson(`${BASE}/schedule/games/${encodeURIComponent(gameId)}/preview`);
  return j?.result?.previewData ?? null;
}

export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function str(v, fb = "—") { return (v === null || v === undefined || v === "") ? fb : String(v); }
export function s3(v) { const n = num(v); return n == null ? "—" : n.toFixed(3).replace(/^0/, ""); }
export function s2(v) { const n = num(v); return n == null ? "—" : n.toFixed(2); }

function innToNum(css) {
  const inn2 = css?.inn2;
  if (typeof inn2 === "string") {
    const m = /^(\d+)(?:\s+([12])\/3)?$/.exec(inn2.trim());
    if (m) return (+m[1]) + (m[2] ? (+m[2]) / 3 : 0);
  }
  const n = num(css?.inn);
  if (n != null) { const w = Math.floor(n), d = Math.round((n - w) * 10); return w + (d === 1 ? 1 / 3 : d === 2 ? 2 / 3 : 0); }
  return null;
}

export function starterLine(starter) {
  const css = starter?.currentSeasonStats;
  if (!css) return "—";
  const w = num(css.w), l = num(css.l), era = css.era;
  const parts = [];
  if (w != null && l != null) parts.push(`${w}승 ${l}패`);
  if (era != null) parts.push(`ERA ${s2(era)}`);
  return parts.length ? parts.join(" · ") : "—";
}

function buildVsPitcher(starter) {
  const vs = starter?.currentSeasonStatsOnOpponents;
  if (!vs) return { ERA: "—", WHIP: "—", "K/9": "—" };
  const n = num(vs.inn); let ip = null;
  if (n != null) { const w = Math.floor(n), d = Math.round((n - w) * 10); ip = w + (d === 1 ? 1 / 3 : d === 2 ? 2 / 3 : 0); }
  const k9 = (num(vs.kk) != null && ip) ? (vs.kk * 9 / ip) : null;
  return {
    ERA: s2(vs.era),
    WHIP: (num(vs.hit) != null && num(vs.bb) != null && ip) ? s2((vs.hit + vs.bb) / ip) : "—",
    "K/9": k9 == null ? "—" : k9.toFixed(2)
  };
}

export function mapStarter(starter, lg = {}) {
  const info = starter?.playerInfo || {};
  const css = starter?.currentSeasonStats || {};
  const name = str(info.name, null);
  if (!name) return null;
  const ip = innToNum(css);
  const raw = {
    IP: ip, H: num(css.hit), HR: num(css.hr), BB: num(css.bb), HBP: num(css.hp),
    SO: num(css.kk), ER: num(css.er), R: num(css.r), TBF: null, QS: null, ERA: css.era, WHIP: css.whip
  };
  const cc = computePitcher(raw, lg);
  const KIND = { FAST: ["포심", "#7FD1A7"], TWOS: ["투심", "#8FD17F"], CUTT: ["커터", "#E07A6B"], SLID: ["슬라이더", "#E8A06B"], SWEE: ["스위퍼", "#E8C067"], CURV: ["커브", "#8FB7E8"], CHUP: ["체인지업", "#C79BE8"], FORK: ["포크", "#6BB0E8"], SINK: ["싱커", "#9BD1B0"] };
  const kinds = starter?.currentPitKindStats;
  let mix = null;
  if (Array.isArray(kinds) && kinds.length) {
    mix = kinds.filter(k => num(k.pit_rt) != null).sort((a, b) => b.pit_rt - a.pit_rt)
      .map(k => { const m = KIND[k.type] || [k.type, "#8A9A93"]; return [`${m[0]} ${Math.round(k.pit_rt)}%${k.speed ? ` (${Math.round(k.speed)})` : ""}`, Math.round(k.pit_rt), m[1]]; });
    const sum = mix.reduce((a, m) => a + m[1], 0);
    if (sum < 100 && sum > 0) mix.push(["기타", 100 - sum, "#3E4E48"]);
  }
  const hand = str(info.hitType, "").includes("좌") ? "좌완" : "우완";
  return {
    name, hand, key: cc.key, vsKey: buildVsPitcher(starter),
    detail: cc.detail, vsDetail: Object.fromEntries(Object.keys(cc.detail).map(k => [k, "—"])),
    adv: cc.adv, vsAdv: Object.fromEntries(Object.keys(cc.adv).map(k => [k, "—"])),
    mix: mix && mix.length ? mix : [["구종 데이터 미제공", 100, "#3E4E48"]],
    note: `등번호 ${str(info.backnum)} · ${hand} — 세부 지표는 시즌 기록 기반 자체 계산`
  };
}

export function mapLineup(lineup) {
  const full = lineup?.fullLineUp;
  if (!Array.isArray(full)) return null;
  const batters = full.filter(p => num(p.batorder) >= 1 && num(p.batorder) <= 9).sort((a, b) => a.batorder - b.batorder);
  if (batters.length !== 9) return null;
  const POS = { "1": "P", "2": "C", "3": "1B", "4": "2B", "5": "3B", "6": "SS", "7": "LF", "8": "CF", "9": "RF", "0": "DH" };
  const dKeys = { wOBA: "—", "BB%": "—", "K%": "—", ISO: "—", BABIP: "—", "득점권": "—", SB: "—", HR: "—" };
  const aKeys = { RC27: "—", GPA: "—", "BB/K": "—", PSN: "—", "AB/HR": "—", SecA: "—" };
  const out = batters.map((p, i) => {
    const name = str(p.playerName, null);
    if (!name) return null;
    return {
      ord: i + 1, name,
      pos: str(p.positionName || POS[String(p.position)], "—"),
      key: { AVG: "—", OPS: "—", wRCp: "—" }, vsKey: { AVG: "—", OPS: "—", wRCp: "—" },
      detail: { ...dKeys }, vsDetail: { ...dKeys }, adv: { ...aKeys }, vsAdv: { ...aKeys },
      radar: [50, 50, 50, 50, 50],
      note: `${str(p.hitType, "")} · 등번호 ${str(p.backnum)} — 상세 시즌 지표는 기록실 연동 예정`
    };
  }).filter(Boolean);
  return out.length === 9 ? out : null;
}

export function standingStr(st) {
  if (!st) return null;
  const w = num(st.w), l = num(st.l), d = num(st.d), rank = num(st.rank);
  if (w == null || l == null) return null;
  return `${w}승 ${d ?? 0}무 ${l}패${rank != null ? ` · ${rank}위` : ""}`;
}

export function h2hFromPreview(pv, myNaverCode) {
  const sv = pv?.seasonVsResult;
  if (!sv) return null;
  const meHome = sv.hCode === myNaverCode;
  return meHome
    ? { w: num(sv.hw) ?? 0, l: num(sv.hl) ?? 0, d: num(sv.hd) ?? 0 }
    : { w: num(sv.aw) ?? 0, l: num(sv.al) ?? 0, d: num(sv.ad) ?? 0 };
}

export function recentFromPreview(games, myNaverCode) {
  if (!Array.isArray(games)) return null;
  const seq = [];
  for (const g of games.slice(0, 5)) {
    const meHome = g.hCode === myNaverCode;
    const my = num(meHome ? g.hScore : g.aScore);
    const op = num(meHome ? g.aScore : g.hScore);
    if (my == null || op == null) continue;
    seq.push(my > op ? "W" : my < op ? "L" : "D");
  }
  return seq.length ? seq : null;
}
