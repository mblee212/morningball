/* KBO 공식 팀 기록 페이지(서버 렌더링, 단일 GET) → 리그 합계 → 리그 상수
   타자: Record/Team/Hitter/Basic1.aspx (+BasicOld/세부는 헤더로 자동 매핑)
   투수: Record/Team/Pitcher/Basic1.aspx */
import { leagueConstants } from "./compute.mjs";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; MorningBall/1.0)" };
const BAT1 = "https://www.koreabaseball.com/Record/Team/Hitter/Basic1.aspx";  /* PA·AB·H·2B·3B·HR·R·SF */
const BAT2 = "https://www.koreabaseball.com/Record/Team/Hitter/Basic2.aspx";  /* BB·IBB·HBP·SO */
const PIT = "https://www.koreabaseball.com/Record/Team/Pitcher/Basic1.aspx";

async function getHtml(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(url, { headers: UA, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

/* 헤더명 기반 테이블 파싱 → [{컬럼:값}] */
function parseTable(html) {
  const thead = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1].replace(/<[^>]+>/g, "").trim()))
    .filter(cells => cells.length >= 5 && /^\d+$/.test(cells[0]));
  if (!thead.length || !rows.length) throw new Error("팀 기록 테이블 파싱 실패");
  return rows.map(cells => Object.fromEntries(thead.map((h, i) => [h, cells[i]])));
}

const sum = (rows, col) => {
  const vals = rows.map(r => Number(r[col])).filter(Number.isFinite);
  return vals.length === rows.length && rows.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
};
/* IP는 "1234.1" 표기 — 합산 시 아웃 단위로 변환 */
const sumIP = rows => {
  let outs = 0;
  for (const r of rows) {
    const m = /^(\d+)(?:\.(\d))?$/.exec(r["IP"] || "");
    if (!m) return null;
    outs += (+m[1]) * 3 + (+(m[2] || 0));
  }
  return Math.floor(outs / 3) + (outs % 3) / 10; /* 다시 x.1/x.2 표기 */
};

export async function getLeagueConstants() {
  const [b1h, b2h, ph] = await Promise.all([getHtml(BAT1), getHtml(BAT2), getHtml(PIT)]);
  const bat = parseTable(b1h), bat2 = parseTable(b2h), pit = parseTable(ph);
  if (bat.length !== 10 || bat2.length !== 10 || pit.length !== 10)
    throw new Error(`팀 수 이상 (타1 ${bat.length}/타2 ${bat2.length}/투 ${pit.length})`);
  const B = {
    PA: sum(bat, "PA") ?? sum(bat, "TPA"), AB: sum(bat, "AB"), R: sum(bat, "R"), H: sum(bat, "H"),
    H2: sum(bat, "2B"), H3: sum(bat, "3B"), HR: sum(bat, "HR"), SF: sum(bat, "SF") ?? sum(bat2, "SF"),
    BB: sum(bat2, "BB"), IBB: sum(bat2, "IBB"), HBP: sum(bat2, "HBP"), SO: sum(bat2, "SO")
  };
  const P = { IP: sumIP(pit), ER: sum(pit, "ER"), HR: sum(pit, "HR"), BB: sum(pit, "BB"), HBP: sum(pit, "HBP"), SO: sum(pit, "SO") };
  const lg = leagueConstants(B, P);
  if (lg.lgWOBA == null || lg.lgRPA == null || lg.cFIP == null)
    throw new Error("리그 상수 산출 실패 — 필요 컬럼 누락: " + JSON.stringify({ B, P }));
  return lg;
}
