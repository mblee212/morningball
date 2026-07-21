/* 배치 오케스트레이션
   원칙 1: 소스별 독립 수집 — 하나가 실패해도 나머지는 반영 (부분 실패 격리)
   원칙 2: 실패한 소스의 영역은 이전 정상 데이터를 그대로 유지
   원칙 3: 최종 조립본이 스키마 검증을 통과해야만 저장 */
import { getStore } from "@netlify/blobs";
import { validateData, kstStamp, kstToday, kstNow } from "./_lib.mjs";
import { TEAMCODE, NAVER2CODE, getGames, findGame, isHome, getPreview, getPlayerRecord, num, str, s2, starterLine, mapStarter, mapLineup, mapBatterRecord, mapPitcherRecord, mapBullpenList, standingStr, h2hFromPreview, recentFromPreview } from "./collectors/naver.mjs";
import { getStandings } from "./collectors/kbo.mjs";
import { stadiumInfo, getForecast, getAir, buildPlayable } from "./collectors/weather.mjs";
import { getNews } from "./collectors/news.mjs";
import { getLeagueConstants } from "./collectors/kbostats.mjs";

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

/* ─────────────────── 1배치: 당일 0시 — 선발/경기정보/진행가능성/순위/뉴스 ─────────────────── */
export async function runBatch1() {
  const store = getStore("morningball");
  const prev = await store.get("data", { type: "json" });
  if (!prev) return resp(500, "seed 없음 — data.json을 blob에 1회 시드해야 합니다 (README 참조)");

  const fresh = structuredClone(prev);
  const sources = {};
  const today = kstToday();
  const todayCompact = today.replaceAll("-", "");

  /* 오늘 경기 일정 (필수 소스 — 실패 시 배치 중단, 이전 데이터 유지) */
  let games;
  try { games = await getGames(today); sources.schedule = "ok"; }
  catch (e) { sources.schedule = "FAIL " + e.message; return fail(store, prev, sources, "일정 수집 실패"); }

  /* 리그 상수 (wRC+·FIP 계산용) — 실패해도 배치는 계속, 해당 지표만 — 표기 */
  let lg = {};
  try { lg = await getLeagueConstants(); fresh.meta_lg = lg; sources.league = "ok"; }
  catch (e) { lg = prev.meta_lg || {}; sources.league = "keep-prev: " + e.message; }

  const previewCache = {}; /* 한 경기를 두 팀이 공유 — 프리뷰 중복 호출 방지 */
  const weatherCache = {}; /* 같은 구장·시각 날씨 재사용 */

  for (const teamKey of Object.keys(TEAMCODE)) {
    const code = TEAMCODE[teamKey];
    const T = fresh.teams[teamKey];
    const game = findGame(games, code);

    if (!game) { /* 휴식일 처리 */
      T.game = { ...T.game,
        opp: "오늘 경기 없음", oppShort: "—", oppRec: "—", time: "OFF",
        venue: "오늘은 편성된 경기가 없어요", meta: dateLabel() + " · 휴식일",
        homeSP: "—", homeSPline: "—", awaySP: "—", awaySPline: "—",
        playable: 0, verdict: "오늘 경기 없음",
        risks: [{ ico: "⚾", t: "경기 일정", d: "KBO 공식 일정 기준 오늘은 경기가 없습니다", lv: "good", lvt: "휴식일" }]
      };
      continue;
    }

    const myHome = isHome(game, code);
    const oppNaver = myHome ? game.awayTeamCode : game.homeTeamCode;
    const oppKey = NAVER2CODE[oppNaver];
    const oppName = str(myHome ? game.awayTeamName : game.homeTeamName, oppKey ? fresh.teams[oppKey]?.name : "상대팀");
    const hhmm = (String(game.gameDateTime || "").match(/T(\d{2}:\d{2})/) || [])[1] || "18:30";

    T.game.opp = oppName;
    T.game.oppShort = oppKey ? fresh.teams[oppKey].short : oppName.slice(0, 2);
    T.game.time = hhmm;
    T.game.meta = `${dateLabel()} · ${myHome ? "홈" : "원정"} 경기`;
    /* 구장·venue는 프리뷰 gameInfo.stadium에서 확정 (없으면 임시) */
    T.game.venue = `구장 확인 중 (${myHome ? "홈" : "원정"})`;

    /* 프리뷰 (같은 경기 상대팀과 공유): 선발·구장·상대전적·record 확정 */
    let pv = null;
    try {
      if (!(game.gameId in previewCache)) previewCache[game.gameId] = await getPreview(game.gameId);
      pv = previewCache[game.gameId];
      if (!pv) throw new Error("preview 없음");
      sources[`preview_${teamKey}`] = "ok";
    } catch (e) { sources[`preview_${teamKey}`] = "keep-prev: " + e.message; }

    /* 구장 (독립) */
    if (pv) {
      const stadium = str(pv.gameInfo?.stadium, "");
      if (stadium) T.game.venue = `${stadium} (${myHome ? "홈" : "원정"})`;
    }

    /* 선발명 (독립 — 지표 계산이 실패해도 이름은 반드시 채움) */
    if (pv) {
      try {
        const myStarter = myHome ? pv.homeStarter : pv.awayStarter;
        const opStarter = myHome ? pv.awayStarter : pv.homeStarter;
        const myName = str(myStarter?.playerInfo?.name, null);
        const opName = str(opStarter?.playerInfo?.name, null);
        if (myName) { T.game.homeSP = myName; T.game.homeSPline = starterLine(myStarter); }
        if (opName) { T.game.awaySP = opName; T.game.awaySPline = starterLine(opStarter); }
        /* 선발 카드(지표)는 별도 try — 실패해도 위 이름은 유지됨 */
        try {
          const mySP = mapStarter(myStarter, lg);
          if (mySP) T.pitchers.starter = { ...T.pitchers.starter, ...mySP, note: `${oppName} 상대 등판 — 지표는 시즌 기록 기반 자체 계산` };
        } catch { /* 카드 계산 실패 — 이름/라인은 이미 채워짐 */ }
        sources[`starter_${teamKey}`] = myName ? "ok" : "이름 없음";
      } catch (e) { sources[`starter_${teamKey}`] = "keep-prev: " + e.message; }
    }

    /* record & 상대 record (독립) */
    if (pv) {
      try {
        const myRec = standingStr(myHome ? pv.homeStandings : pv.awayStandings);
        const opRec = standingStr(myHome ? pv.awayStandings : pv.homeStandings);
        if (myRec) T.record = myRec;
        if (opRec) T.game.oppRec = opRec;
      } catch { /* record 실패 — 순위표(deriveFromStandings)가 이후 보정 */ }
    }

    /* 상대전적 (독립 — 조회 팀 code 기준) */
    if (pv) {
      try {
        const h = h2hFromPreview(pv, code);
        const recent = recentFromPreview(myHome ? pv.homeTeamPreviousGames : pv.awayTeamPreviousGames, code);
        if (h) {
          T.h2h.my = fresh.teams[teamKey].short;
          T.h2h.op = T.game.oppShort;
          T.h2h.w = h.w; T.h2h.l = h.l; T.h2h.d = h.d;
          if (recent) T.h2h.recent = recent;
          T.h2h.notes = [`시즌 상대전적 ${h.w}승 ${h.d}무 ${h.l}패`].concat(recent ? [`최근 5경기 ${recent.join(" ")}`] : []);
          sources[`h2h_${teamKey}`] = "ok";
        } else sources[`h2h_${teamKey}`] = "상대전적 미제공 — 이전 유지";
      } catch (e) { sources[`h2h_${teamKey}`] = "keep-prev: " + e.message; }
    }

    /* 진행 가능성 (기상청 + 에어코리아) — 구장은 프리뷰에서 확정된 venue 사용 */
    try {
      const loc = stadiumInfo(T.game.venue);
      const gameHour = parseInt(hhmm.slice(0, 2), 10) || 18;
      const wKey = `${loc.nx},${loc.ny}|${gameHour}`;
      if (!(wKey in weatherCache)) {
        const [fc, air] = await Promise.allSettled([getForecast(loc, gameHour, todayCompact), getAir(loc)]);
        const kmaMsg = fc.status === "fulfilled" ? "kma ok" : ("kma FAIL(" + (fc.reason?.message || "?").slice(0, 40) + ")");
        const airMsg = air.status === "fulfilled" ? "air ok" : ("air FAIL(" + (air.reason?.message || "?").slice(0, 45) + ")");
        weatherCache[wKey] = {
          built: buildPlayable(fc.status === "fulfilled" ? fc.value : null, air.status === "fulfilled" ? air.value : null),
          log: kmaMsg + " / " + airMsg
        };
      }
      const built = weatherCache[wKey].built;
      T.game.playable = built.playable;
      T.game.verdict = built.verdict;
      T.game.risks = built.risks;
      sources[`weather_${teamKey}`] = weatherCache[wKey].log;
    } catch (e) { sources[`weather_${teamKey}`] = "keep-prev: " + e.message; }
  }

  /* 순위 (+ record/맞대결 바/재미 지표 파생) */
  try {
    const st = await getStandings(prev.standings);
    fresh.standings = st;
    for (const teamKey of Object.keys(TEAMCODE)) deriveFromStandings(fresh, teamKey, st);
    sources.standings = "ok";
  } catch (e) { sources.standings = "keep-prev: " + e.message; }

  /* 뉴스 (전날 00:00 KST ~ 현재) */
  try {
    const d = kstNow();
    const yStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1) - 9 * 3600 * 1000;
    fresh.news = await getNews(yStart);
    sources.news = "ok";
  } catch (e) { sources.news = "keep-prev: " + e.message; }

  if (!validateData(fresh)) return fail(store, prev, sources, "조립본 검증 실패");
  fresh.meta = { ...(prev.meta || {}), date: kstToday(), batch1: kstStamp(), batch2: null, sources };
  await store.setJSON("data", fresh);
  return resp(200, "batch1 ok " + fresh.meta.batch1 + " | " + JSON.stringify(sources));
}

/* ─────────────────── 2배치: 경기 시작 90분 전 — 확정 라인업 ─────────────────── */
export async function runBatch2({ force = false } = {}) {
  const store = getStore("morningball");
  const prev = await store.get("data", { type: "json" });
  if (!prev) return resp(200, "데이터 없음 — batch1 선행 필요");
  if (!force && prev.meta?.batch2 && prev.meta?.date === kstToday()) return resp(200, "오늘 2배치 기실행");

  /* 시작 -90분 도달 판정 */
  const starts = Object.keys(TEAMCODE)
    .map(t => prev.teams?.[t]?.game?.time)
    .map(hhmm => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
      if (!m) return null;
      const d = kstNow();
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +m[1], +m[2]) - 9 * 3600 * 1000;
    }).filter(v => v !== null);
  if (!starts.length) return resp(200, "오늘 경기 없음 — skip");
  if (!force && Date.now() < Math.min(...starts) - 90 * 60000) return resp(200, "T-90분 이전 — skip");

  const fresh = structuredClone(prev);
  const sources = {};
  const today = kstToday();
  let updatedAny = false;

  let games;
  try { games = await getGames(today); }
  catch (e) { return fail(store, prev, { schedule: e.message }, "일정 수집 실패"); }

  let lg = prev.meta_lg || {};
  try { if (!lg.lgWOBA) { lg = await getLeagueConstants(); fresh.meta_lg = lg; } }
  catch (e) { sources.league = "keep-prev: " + e.message; }

  for (const teamKey of Object.keys(TEAMCODE)) {
    const code = TEAMCODE[teamKey];
    const game = findGame(games, code);
    if (!game) { sources[`lineup_${teamKey}`] = "경기 없음"; continue; }
    try {
      const pv = await getPreview(game.gameId);
      const myHome = isHome(game, code);
      const lineup = myHome ? pv?.homeTeamLineUp : pv?.awayTeamLineUp;
      const baseList = mapLineup(lineup);
      if (!baseList) throw new Error("라인업 미발표 또는 9인 미만");
      /* 오늘 상대팀 네이버코드 (vsTeam 기록 추출용) */
      const oppNaver = myHome ? game.awayTeamCode : game.homeTeamCode;
      /* 각 타자의 시즌 기록을 개별 조회해 지표 채움 (실패 시 그 선수만 이름/포지션 유지) */
      const batters = [];
      for (const base of baseList) {
        let filled = base;
        if (base.playerCode) {
          try {
            const rec = await getPlayerRecord(base.playerCode);
            const m = rec ? mapBatterRecord(base, rec, oppNaver) : null;
            if (m) filled = m;
          } catch { /* 개별 실패는 무시하고 기본 카드 유지 */ }
        }
        /* 내부용 필드 제거 */
        const { playerCode, hitType, backnum, ...clean } = filled;
        batters.push(clean);
      }
      fresh.teams[teamKey].batters = batters;
      const filledCount = batters.filter(b => b.key.AVG !== "—").length;

      /* 불펜 투수: 오늘 엔트리 명단(pitcherBullpen)의 전원으로 교체.
         부상/말소자는 명단에 없어 자동 제외. 개별 실패는 그 투수만 이름 유지.
         전원 조회하되 5명씩 병렬 묶음으로 처리해 지연 최소화. */
      try {
        const bpBase = mapBullpenList(lineup);
        if (bpBase && bpBase.length) {
          const emptyCard = b => ({ name: b.name, hand: str(b.hitType, "").includes("좌") ? "좌완" : "우완", role: "계투", key: { ERA: "—", WHIP: "—", "K/9": "—" }, vsKey: { ERA: "—", WHIP: "—", "K/9": "—" }, detail: { FIP: "—", "BB/9": "—", "HR/9": "—", HLD: "—", "피안타율": "—", "이닝": "—", "K%": "—" }, vsDetail: { FIP: "—", "BB/9": "—", "HR/9": "—", HLD: "—", "피안타율": "—", "이닝": "—", "K%": "—" }, adv: { kwERA: "—", "K-BB%": "—", "K/BB": "—", "LOB%": "—" }, vsAdv: { kwERA: "—", "K-BB%": "—", "K/BB": "—", "LOB%": "—" }, note: "오늘 엔트리 등록 불펜" });
          const bullpen = [];
          for (let i = 0; i < bpBase.length; i += 5) {
            const chunk = bpBase.slice(i, i + 5);
            const cards = await Promise.all(chunk.map(async b => {
              try {
                const rec = await getPlayerRecord(b.playerCode);
                const m = rec ? mapPitcherRecord(b, rec, oppNaver) : null;
                if (m) { const { mix, ...rest } = m; return rest; } /* 불펜 카드엔 mix 미표시 */
              } catch { /* 개별 실패는 무시 */ }
              return emptyCard(b);
            }));
            bullpen.push(...cards);
          }
          if (bullpen.length) {
            fresh.teams[teamKey].pitchers.bullpen = bullpen;
            sources[`bullpen_${teamKey}`] = `ok (${bullpen.length}명, 지표 ${bullpen.filter(x => x.key.ERA !== "—").length})`;
          }
        }
      } catch (e) { sources[`bullpen_${teamKey}`] = "keep-prev: " + e.message; }

      updatedAny = true;
      sources[`lineup_${teamKey}`] = `ok (지표 ${filledCount}/9)`;
    } catch (e) { sources[`lineup_${teamKey}`] = "keep-prev: " + e.message; }
  }

  if (!updatedAny) return resp(200, "라인업 미발표 — 다음 주기 재시도 | " + JSON.stringify(sources));
  if (!validateData(fresh)) return fail(store, prev, sources, "조립본 검증 실패");
  fresh.meta = { ...(prev.meta || {}), date: today, batch2: kstStamp(), sources: { ...(prev.meta?.sources || {}), ...sources } };
  await store.setJSON("data", fresh);
  return resp(200, "batch2 ok " + fresh.meta.batch2 + " | " + JSON.stringify(sources));
}

/* ─────────────────── 파생값: 순위표 → record/맞대결 바/재미 카드 ─────────────────── */
function deriveFromStandings(fresh, teamKey, st) {
  const T = fresh.teams[teamKey];
  const me = st.find(s => s.mine === teamKey);
  if (!me) return;
  T.record = `${me.w}승 ${me.d}무 ${me.l}패 · ${me.rk}위`;
  const oppShort = T.game.oppShort;
  const op = st.find(s => oppShort !== "—" && s.team.includes(oppShort));
  if (op) {
    T.game.oppRec = `${op.w}승 ${op.d}무 ${op.l}패 · ${op.rk}위`;
    const pm = Number("0" + me.pct) || me.w / Math.max(1, me.w + me.l);
    const po = Number("0" + op.pct) || op.w / Math.max(1, op.w + op.l);
    T.h2h.bars = [
      { l: "시즌 승률", me: pm, op: po, max: 0.75, fmt: 3 },
      { l: "시즌 승수", me: me.w, op: op.w, max: 90, fmt: 0 },
      { l: "최근 10경기 승", me: me.ten.filter(x => x === "W").length, op: op.ten.filter(x => x === "W").length, max: 10, fmt: 0 },
      { l: "리그 순위", me: me.rk, op: op.rk, max: 10, fmt: 0, invert: true }
    ];
    /* 승리 확률: log5 + 홈 어드밴티지 3% */
    const home = T.game.venue.includes("(홈)") ? 0.03 : -0.03;
    const raw = (pm - pm * po) / (pm + po - 2 * pm * po || 0.5);
    T.fun.winprob = Math.round(Math.max(5, Math.min(95, (raw + home) * 100)));
  }
  T.fun.streak = { n: me.stk === "—" ? "기록 집계 중" : me.stk, d: `최근 10경기 ${me.ten.filter(x => x === "W").length}승 · 시즌 승률 ${me.pct}` };
  T.fun.magic = me.rk === 1
    ? { n: "1위", d: `2위와 ${st[1].gb}경기 차 선두 질주 중` }
    : { n: `-${me.gb}`, d: `1위 ${st[0].team}과의 게임차 · 현재 ${me.rk}위` };
  T.fun.keymatch = { a: T.batters[2]?.name || "중심 타자", b: T.game.awaySP, stats: [["오늘 선발 상대", T.batters[2]?.vsKey?.AVG || "—"], ["시즌 OPS", T.batters[2]?.key?.OPS || "—"]] };
  T.fun.tips = T.game.venue.includes("(홈)") ? TIPS.home : TIPS.away;
  T.fun.trivia = TRIVIA[kstNow().getUTCDay()];
}

const TIPS = {
  home: ["홈경기 — 경기 90분 전 도착 추천, 라인업 확정도 그때쯤 발표됩니다", "우천 취소 여부는 보통 경기 2~3시간 전 KBO 공지로 발표됩니다", "예매는 구단 공식 앱·티켓링크에서"],
  away: ["원정 경기 — 원정석 예매는 조기 매진이 잦으니 서두르세요", "우천 취소 여부는 보통 경기 2~3시간 전 KBO 공지로 발표됩니다", "구장별 외부 음식 반입 규정을 미리 확인하세요"]
};
const TRIVIA = [
  "WHIP이란? 이닝당 출루 허용 수. 1.20 이하면 리그 상위권 선발로 봅니다.",
  "피타고리안 승률이란? 득점·실점만으로 계산한 기대 승률. 실제 승률과의 차이는 접전 승부 운·불펜의 힘을 보여줍니다.",
  "wRC+란? 리그 평균 100 기준의 타격 생산력. 파크팩터까지 보정해 구장 차이를 지웁니다.",
  "FIP란? 삼진·볼넷·피홈런만으로 본 평균자책. 수비 도움을 걷어낸 투수 본연의 실력입니다.",
  "BABIP이란? 인플레이 타구의 안타 비율. 리그 평균(약 .300)에서 크게 벗어나면 운이 개입했을 가능성이 있습니다.",
  "QS(퀄리티스타트)란? 선발이 6이닝 이상 3자책 이하로 막는 것. 로테이션의 안정감을 보는 기본 지표입니다.",
  "OPS란? 출루율+장타율. 간단하지만 득점 생산과 상관관계가 매우 높아 가장 널리 쓰입니다."
];

function dateLabel() {
  const d = kstNow();
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${DAYS[d.getUTCDay()]})`;
}
async function fail(store, prev, sources, msg) {
  console.error("[batch] " + msg, sources);
  return resp(500, msg + " — 마지막 정상 데이터 유지 | " + JSON.stringify(sources));
}
function resp(status, body) { return new Response(body, { status }); }
