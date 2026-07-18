/* 네이버 스포츠 비공식 JSON API 수집기
   ─ 경기 일정·선발투수·프리뷰(라인업, 상대 기록)를 가져온다.
   ─ 비공식 API 특성상 필드명이 바뀔 수 있어 모든 접근을 방어적으로 처리하고,
     실패 시 null을 반환해 상위에서 "이전 정상 데이터 유지"로 폴백시킨다. */

import { computeBatter } from "./compute.mjs";

const BASE = "https://api-gw.sports.naver.com";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; MorningBall/1.0)", "Referer": "https://sports.naver.com" };

/* 팀 코드: 네이버는 SSG를 구단 연혁상 'SK', 두산을 'OB', 키움을 'WO'(우리/넥센 연혁)로 사용 */
export const TEAMCODE = {
  lg: "LG", ob: "OB", ssg: "SK", kia: "HT", ss: "SS",
  kt: "KT", nc: "NC", lt: "LT", hh: "HH", wo: "WO"
};

async function getJson(url, timeoutMs = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* 특정 날짜의 KBO 경기 목록 */
export async function getGames(dateStr /* YYYY-MM-DD */) {
  const url = `${BASE}/schedule/games?fields=basic,schedule,baseball&upperCategoryId=kbaseball&categoryId=kbo&fromDate=${dateStr}&toDate=${dateStr}&size=50`;
  const j = await getJson(url);
  const games = j?.result?.games;
  if (!Array.isArray(games)) throw new Error("games 필드 없음 — API 구조 변경 의심");
  return games;
}

/* 팀 코드로 오늘 경기 찾기 */
export function findGame(games, code) {
  return games.find(g =>
    (g.homeTeamCode === code || g.awayTeamCode === code) &&
    String(g.statusCode || "").toUpperCase() !== "CANCEL"
  ) || null;
}

/* 경기 프리뷰: 선발투수 시즌/상대 기록 + 라인업 + 타자별 시즌/상대 기록 */
export async function getPreview(gameId) {
  const j = await getJson(`${BASE}/schedule/games/${encodeURIComponent(gameId)}/preview`);
  return j?.result?.previewData ?? j?.result ?? null;
}

/* 정규시즌 전체 일정 1회 수집 (모든 팀 페어 집계에 재사용) */
export async function getSeasonGames(seasonStart, today) {
  const url = `${BASE}/schedule/games?fields=basic,schedule,baseball&upperCategoryId=kbaseball&categoryId=kbo&fromDate=${seasonStart}&toDate=${today}&size=1200`;
  const j = await getJson(url, 12000);
  const games = j?.result?.games;
  if (!Array.isArray(games)) throw new Error("season games 없음");
  return games;
}

/* 수집해 둔 시즌 일정에서 두 팀 맞대결만 집계 */
export function computeH2H(allGames, myCode, oppCode) {
  const games = (allGames || []).filter(g => {
    const set = new Set([g.homeTeamCode, g.awayTeamCode]);
    return set.has(myCode) && set.has(oppCode) &&
      String(g.statusCode || "").toUpperCase() === "RESULT";
  });
  let w = 0, l = 0, d = 0;
  const seq = [];
  for (const g of games) {
    const myHome = g.homeTeamCode === myCode;
    const my = num(myHome ? g.homeTeamScore : g.awayTeamScore);
    const op = num(myHome ? g.awayTeamScore : g.homeTeamScore);
    if (my == null || op == null) continue;
    if (my > op) { w++; seq.push("W"); }
    else if (my < op) { l++; seq.push("L"); }
    else { d++; seq.push("D"); }
  }
  if (!seq.length) return null;
  return { w, l, d, recent: seq.slice(-5) };
}
/* 하위 호환 래퍼 */
export async function getHeadToHead(myCode, oppCode, seasonStart, today) {
  return computeH2H(await getSeasonGames(seasonStart, today), myCode, oppCode);
}

/* ── 프리뷰 → 모닝볼 스키마 매핑 헬퍼 (필드명 후보를 순차 탐색) ── */
export function pick(obj, ...keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, p) => (o == null ? undefined : o[p]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}
export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function s3(v) { /* 0.326 → ".326" */
  const n = num(v);
  return n == null ? "—" : n.toFixed(3).replace(/^0/, "");
}
export function s2(v) { const n = num(v); return n == null ? "—" : n.toFixed(2); }
export function str(v, fb = "—") { return (v === null || v === undefined || v === "") ? fb : String(v); }

/* 프리뷰에서 선발투수 요약 라인 만들기: "9승 3패 · ERA 2.87" */
export function starterLine(p) {
  if (!p) return "—";
  const w = num(pick(p, "wins", "w", "seasonWins"));
  const l = num(pick(p, "losses", "l", "seasonLosses"));
  const era = pick(p, "era", "seasonEra", "stats.era");
  const parts = [];
  if (w != null && l != null) parts.push(`${w}승 ${l}패`);
  if (era != null) parts.push(`ERA ${s2(era)}`);
  return parts.length ? parts.join(" · ") : "—";
}

/* 프리뷰 라인업 항목 → 타자 스키마
   1) 카운팅 기록(타석·볼넷·삼진…)을 후보키로 최대한 수집
   2) compute 모듈로 세이버 지표 자체 계산 — 입력이 없으면 "—" (지어내지 않음) */
export function mapBatter(entry, ord, lg = {}) {
  const name = str(pick(entry, "playerName", "name"), null);
  if (!name) return null;
  const avg = pick(entry, "seasonAvg", "avg", "hra", "batting.avg");
  const ops = pick(entry, "seasonOps", "ops", "batting.ops");
  const obp = num(pick(entry, "obp", "batting.obp"));
  const slg = num(pick(entry, "slg", "batting.slg"));
  const hr  = pick(entry, "hr", "batting.hr");
  const rbi = pick(entry, "rbi", "batting.rbi");
  const sb  = pick(entry, "sb", "batting.sb");
  const vsAvg = pick(entry, "vsAvg", "vsPitcherAvg", "matchup.avg");
  const vsOps = pick(entry, "vsOps", "matchup.ops");
  const a = num(avg), o = num(ops);
  /* 카운팅 기록 후보키 수집 → 자체 계산 */
  const raw = {
    PA: pick(entry, "pa", "tpa", "batting.pa"), AB: pick(entry, "ab", "batting.ab"),
    H: pick(entry, "h", "hit", "batting.h"), H2: pick(entry, "h2", "2b", "double", "batting.h2"),
    H3: pick(entry, "h3", "3b", "triple", "batting.h3"), HR: hr,
    BB: pick(entry, "bb", "batting.bb"), IBB: pick(entry, "ibb"), HBP: pick(entry, "hbp", "hp"),
    SO: pick(entry, "so", "kk", "batting.so"), SF: pick(entry, "sf"),
    SB: sb, CS: pick(entry, "cs"), AVG: avg, OBP: obp, SLG: slg,
    RISP: pick(entry, "rispAvg", "scoringPositionAvg")
  };
  const cc = computeBatter(raw, lg);
  /* 레이더: 공개 데이터만으로 계산 가능한 항목은 계산, 불가 항목은 중립(50) */
  const clamp = v => Math.max(5, Math.min(98, Math.round(v)));
  const radar = [
    a != null ? clamp((a - 0.200) / 0.15 * 90) : 50,          /* 정확 */
    obp != null ? clamp((obp - 0.280) / 0.15 * 90) : 50,      /* 출루 */
    slg != null ? clamp((slg - 0.300) / 0.30 * 90) : 50,      /* 파워 */
    50,                                                        /* 클러치: 공개 소스 없음 → 중립 */
    num(sb) != null ? clamp(num(sb) / 30 * 90 + 10) : 50      /* 스피드 */
  ];
  return {
    ord,
    name,
    pos: str(pick(entry, "positionName", "position", "pos"), "—"),
    key: { AVG: cc.key.AVG !== "—" ? cc.key.AVG : s3(avg), OPS: cc.key.OPS !== "—" ? cc.key.OPS : (o == null ? "—" : o.toFixed(3).replace(/^0/, "")), wRCp: cc.key.wRCp },
    vsKey: { AVG: s3(vsAvg), OPS: num(vsOps) == null ? "—" : num(vsOps).toFixed(3).replace(/^0/, ""), wRCp: "—" },
    detail: cc.detail,
    vsDetail: { wOBA: "—", "BB%": "—", "K%": "—", ISO: "—", BABIP: "—", "득점권": "—", SB: "—", HR: "—" },
    adv: cc.adv,
    vsAdv: { RC27: "—", GPA: "—", "BB/K": "—", PSN: "—", "AB/HR": "—", SecA: "—" },
    radar,
    note: rbi != null ? `시즌 ${str(hr, "0")}홈런 ${str(rbi)}타점 — 오늘 선발 상대 통산 타율 ${s3(vsAvg)}` : `오늘 선발 상대 통산 타율 ${s3(vsAvg)}`
  };
}
