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
  const aKeys = { WAR: "—", WPA: "—", RBI: "—", OBP: "—", SLG: "—", "2B": "—", "3B": "—", CS: "—" };
  const out = batters.map((p, i) => {
    const name = str(p.playerName, null);
    if (!name) return null;
    return {
      ord: i + 1, name,
      pos: str(p.positionName || POS[String(p.position)], "—"),
      playerCode: str(p.playerCode, null),   /* 선수 기록 조회용 */
      hitType: str(p.hitType, ""), backnum: str(p.backnum, "—"),
      key: { AVG: "—", OPS: "—", wRCp: "—" }, vsKey: { AVG: "—", OPS: "—", wRCp: "—" },
      detail: { ...dKeys }, vsDetail: { ...dKeys }, adv: { ...aKeys }, vsAdv: { ...aKeys },
      radar: [50, 50, 50, 50, 50],
      note: `${str(p.hitType, "")} · 등번호 ${str(p.backnum)} — 상세 지표 조회 중`
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

/* ── 선수 개인 기록 (라인업 타자 지표 채우기) ──
   URL: /players/kbo/{playerCode}/playerend-record
   응답의 basicRecord/record/vsTeam은 문자열 인코딩된 JSON → 재파싱 필요 */
export async function getPlayerRecord(playerCode) {
  const j = await getJson(`${BASE}/players/kbo/${encodeURIComponent(playerCode)}/playerend-record`);
  const r = j?.result;
  if (!r) return null;
  const parse = s => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return null; } };
  const rec = parse(r.record);
  const season = rec?.season?.find(s => String(s.gyear) === String(r.year || "2026")) || null;
  const vsParsed = parse(r.vsTeam);
  const vs = vsParsed?.vsteam || null;
  const basic = parse(r.basicRecord)?.basic || null;
  const chart = parse(r.chart) || null;
  const playerType = r.playerType || null;
  /* 타자용(vs)과 투수용(record.vsTeam/chart) 모두 제공 */
  return { season, vs, basic, chart, playerType, record: { vsTeam: vsParsed } };
}

/* 시즌 카운팅 + 네이버 제공 세이버 지표 → 타자 스키마 한 명분.
   네이버가 wOBA·BABIP·ISO·wRC+를 이미 계산해 주므로 그 값을 우선 사용.
   oppNaver: 오늘 상대팀 네이버코드 (vsTeam에서 해당 팀 기록 추출) */
export function mapBatterRecord(base, rec, oppNaver) {
  const s = rec?.season;
  if (!s) return null;
  const pct = v => { const n = num(v); return n == null ? "—" : (n * 100).toFixed(1) + "%"; };
  const AB = num(s.ab), H = num(s.hit), BB = num(s.bb), SO = num(s.kk), PA = (AB != null && BB != null) ? AB + BB + (num(s.hp) || 0) + (num(s.sf) || 0) : null;
  const bbPct = (BB != null && PA) ? BB / PA : null;
  const kPct = (SO != null && PA) ? SO / PA : null;
  const key = {
    AVG: s3(s.hra), OPS: s3(s.ops),
    wRCp: num(s.wrcPlus) != null ? String(Math.round(s.wrcPlus)) : "—"
  };
  const detail = {
    wOBA: s3(s.woba), "BB%": pct(bbPct), "K%": pct(kPct),
    ISO: num(s.isop) != null ? s3(s.isop) : "—",
    BABIP: num(s.babip) != null ? s3(s.babip) : "—",
    "득점권": "—", SB: str(s.sb), HR: str(s.hr)
  };
  const adv = {
    WAR: num(s.war) != null ? Number(s.war).toFixed(2) : "—",
    WPA: num(s.wpa) != null ? Number(s.wpa).toFixed(2) : "—",
    RBI: str(s.rbi), OBP: s3(s.obp), SLG: s3(s.slg),
    "2B": str(s.h2), "3B": str(s.h3), CS: str(s.cs)
  };
  /* 오늘 상대팀 전적 */
  let vsKey = { AVG: "—", OPS: "—", wRCp: "—" };
  let vsDetail = { wOBA: "—", "BB%": "—", "K%": "—", ISO: "—", BABIP: "—", "득점권": "—", SB: "—", HR: "—" };
  if (Array.isArray(rec.vs) && oppNaver) {
    const v = rec.vs.find(x => x.team === oppNaver);
    if (v) {
      vsKey = { AVG: s3(v.hra), OPS: s3(v.ops), wRCp: "—" };
      const vAB = num(v.ab), vBB = num(v.bbhp);
      vsDetail = {
        wOBA: "—",
        "BB%": (vBB != null && num(v.pa)) ? pct(vBB / v.pa) : "—",
        "K%": (num(v.kk) != null && num(v.pa)) ? pct(v.kk / v.pa) : "—",
        ISO: (num(v.slg) != null && num(v.hra) != null) ? s3(v.slg - Number(v.hra)) : "—",
        BABIP: "—", "득점권": "—", SB: str(v.sb), HR: str(v.hr)
      };
    }
  }
  /* 레이더: 타율·출루·장타·득점권(대체:OPS)·주루(SB) 0~100 정규화 */
  const clamp = v => Math.max(8, Math.min(96, Math.round(v)));
  const avg = num(s.hra) || 0, obp = num(s.obp) || 0, slg = num(s.slg) || 0, sb = num(s.sb) || 0;
  const radar = [
    clamp((avg - 0.2) / 0.13 * 90), clamp((obp - 0.28) / 0.13 * 90),
    clamp((slg - 0.3) / 0.28 * 90), clamp((num(s.wrcPlus) || 100) - 40),
    clamp(sb / 30 * 90 + 8)
  ];
  return {
    name: base.name, pos: base.pos, ord: base.ord,
    key, vsKey, detail, vsDetail, adv,
    vsAdv: { WAR: "—", WPA: "—", RBI: "—", OBP: "—", SLG: "—", "2B": "—", "3B": "—", CS: "—" },
    radar,
    note: `${base.hitType || ""} · 등번호 ${base.backnum || "—"} — WAR ${adv.WAR} · wRC+ ${key.wRCp} (네이버 제공)`
  };
}

/* 투수 개인 기록 → 투수 카드 (불펜/선발 공용).
   season(2026)에 era·w·l·sv·hold·k9·bb9·kbb·kp·bbp·war·wpa·qs·whip 등 완비.
   chart.pit_kind.player에 구종 구사율. */
export function mapPitcherRecord(base, recRaw, oppNaver) {
  const parse = s => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return null; } };
  const rec = recRaw?.record ? recRaw : { record: parse(recRaw?.recordStr), chart: parse(recRaw?.chartStr), vsTeam: parse(recRaw?.vsTeamStr) };
  const season = recRaw?.season || null;
  if (!season) return null;
  const ipStr = str(season.inn, "—");
  const fip = (() => {
    const ip = (() => { const m = /^(\d+)(?:\s+([12])\/3)?$/.exec(String(season.inn).trim()); return m ? (+m[1]) + (m[2] ? (+m[2]) / 3 : 0) : num(season.inn); })();
    if (!ip || ip <= 0) return "—";
    const f = ((13 * (num(season.hr) || 0)) + 3 * ((num(season.bb) || 0) + (num(season.hp) || 0)) - 2 * (num(season.kk) || 0)) / ip + 3.10;
    return f.toFixed(2);
  })();
  const key = { ERA: s2(season.era), WHIP: s2(season.whip), "K/9": num(season.k9) != null ? Number(season.k9).toFixed(2) : "—" };
  const havg = (num(season.hit) != null && num(season.bf) != null && num(season.bf) > 0)
    ? s3(season.hit / (season.bf - (num(season.bb) || 0) - (num(season.hp) || 0) || season.bf)) : "—";
  const role = (num(season.sv) || 0) >= (num(season.hold) || 0) && (num(season.sv) || 0) > 0 ? "SV" : "HLD";
  const detail = {
    FIP: fip, "BB/9": num(season.bb9) != null ? Number(season.bb9).toFixed(2) : "—",
    "HR/9": (() => { const ip = num(season.inn2) ? season.inn2 / 3 : null; return ip ? (season.hr * 9 / ip).toFixed(2) : "—"; })(),
    [role]: str(role === "SV" ? season.sv : season.hold),
    "피안타율": havg, "이닝": ipStr, "K%": num(season.kp) != null ? season.kp + "%" : "—"
  };
  const adv = {
    kwERA: "—", "K-BB%": (num(season.kp) != null && num(season.bbp) != null) ? (season.kp - season.bbp).toFixed(1) + "%" : "—",
    "K/BB": num(season.kbb) != null ? Number(season.kbb).toFixed(2) : "—",
    "LOB%": "—", WAR: num(season.war) != null ? Number(season.war).toFixed(2) : "—", WPA: num(season.wpa) != null ? Number(season.wpa).toFixed(2) : "—"
  };
  /* 상대팀 성적 */
  let vsKey = { ERA: "—", WHIP: "—", "K/9": "—" };
  const vsArr = rec.vsTeam?.vsteam;
  if (Array.isArray(vsArr) && oppNaver) {
    const v = vsArr.find(x => x.team === oppNaver);
    if (v) vsKey = { ERA: s2(v.era), WHIP: s2(v.whip), "K/9": "—" };
  }
  /* 구종 */
  const KMAP = { fast: ["직구", "#7FD1A7"], twos: ["투심", "#8FD17F"], cutt: ["커터", "#E07A6B"], slid: ["슬라이더", "#E8A06B"], swee: ["스위퍼", "#E8C067"], curv: ["커브", "#8FB7E8"], chup: ["체인지업", "#C79BE8"], fork: ["포크", "#6BB0E8"], sink: ["싱커", "#9BD1B0"], spli: ["스플리터", "#B0A0E8"], kunc: ["너클", "#A0A0A0"], slur: ["슬러브", "#D08FB0"] };
  const pk = rec.chart?.pit_kind?.player;
  let mix = null;
  if (pk) {
    mix = Object.entries(pk).filter(([, v]) => num(v.pit_rt) != null && v.pit_rt > 0)
      .sort((a, b) => b[1].pit_rt - a[1].pit_rt)
      .map(([k, v]) => { const m = KMAP[k] || [v.pit || k, "#8A9A93"]; return [`${m[0]} ${Math.round(v.pit_rt)}%${num(v.speed) ? ` (${Math.round(v.speed)})` : ""}`, Math.round(v.pit_rt), m[1]]; });
    const sum = mix.reduce((a, m) => a + m[1], 0);
    if (sum < 100 && sum > 0) mix.push(["기타", 100 - sum, "#3E4E48"]);
  }
  return {
    name: base.name, hand: str(base.hitType, "").includes("좌") ? "좌완" : "우완",
    role: base.role || (role === "SV" ? "마무리" : "계투"),
    key, vsKey, detail,
    vsDetail: Object.fromEntries(Object.keys(detail).map(k => [k, "—"])),
    adv, vsAdv: Object.fromEntries(Object.keys(adv).map(k => [k, "—"])),
    mix: mix && mix.length ? mix : [["구종 데이터 미제공", 100, "#3E4E48"]],
    note: `${str(season.w)}승 ${str(season.l)}패 ${(num(season.sv) || 0) > 0 ? season.sv + "세이브 " : ""}${(num(season.hold) || 0) > 0 ? season.hold + "홀드 " : ""}· WAR ${adv.WAR} (네이버 제공)`
  };
}

/* pitcherBullpen[] → 불펜 투수 기본 정보 목록 (playerCode로 이후 개별 조회) */
export function mapBullpenList(lineup) {
  const bp = lineup?.pitcherBullpen;
  if (!Array.isArray(bp)) return null;
  return bp.map(p => ({
    name: str(p.playerName, null),
    playerCode: str(p.playerCode, null),
    hitType: str(p.hitType, ""),
    role: "계투"
  })).filter(p => p.name && p.playerCode);
}
