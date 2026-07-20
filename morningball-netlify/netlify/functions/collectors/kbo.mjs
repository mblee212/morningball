/* KBO 공식 홈페이지 팀 순위 스크래퍼 (서버 렌더링 HTML → 안정적)
   www.koreabaseball.com/TeamRank/TeamRank.aspx
   컬럼: 순위·팀·경기·승·패·무·승률·게임차·최근10경기·연속 */

const RANK_URL = "https://www.koreabaseball.com/Record/TeamRank/TeamRankDaily.aspx";
const TEAMKEY = { "LG": "lg", "두산": "ob", "SSG": "ssg", "KIA": "kia", "삼성": "ss",
  "KT": "kt", "NC": "nc", "롯데": "lt", "한화": "hh", "키움": "wo" };
const HOMECITY = { "LG": "잠실", "두산": "잠실", "SSG": "인천", "KIA": "광주", "삼성": "대구",
  "KT": "수원", "NC": "창원", "롯데": "부산", "한화": "대전", "키움": "고척" };

export async function getStandings(prevStandings) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10000);
  let html;
  try {
    const r = await fetch(RANK_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MorningBall/1.0)" },
      signal: ac.signal
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    html = await r.text();
  } finally { clearTimeout(t); }

  /* 페이지에 표가 여러 개(순위표·팀간승패표·홈방문표). 순위표만 정확히 집는다.
     순위표 행 형태: [순위(1~10), 팀명, 경기, 승, 패, 무, 승률(0.xxx), 게임차, 최근10(x승x무x패), 연속, 홈, 방문]
     - 팀간승패표는 첫 칸이 팀명(숫자 아님) → 자동 배제
     - 홈/방문표도 규격이 달라 배제됨 */
  const allRows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()));
  const rows = allRows.filter(cells =>
    cells.length >= 10 &&
    /^([1-9]|10)$/.test(cells[0]) &&            /* 1~10 순위 */
    /^0\.\d{3}$/.test(cells[6] || "") &&        /* 7번째 칸이 승률(0.xxx) */
    /\d+승\d+무\d+패/.test(cells[8] || "")       /* 9번째 칸이 최근10경기 */
  );
  if (rows.length !== 10) throw new Error(`순위 행 ${rows.length}개 — 페이지 구조 변경 의심`);

  return rows.map(c => {
    const rk = +c[0], team = c[1];
    const w = +c[3], l = +c[4], d = +c[5];
    const pct = c[6].startsWith("0") ? c[6].slice(1) : c[6];
    const gb = (c[7] === "0.0" || c[7] === "0" || c[7] === "-") ? "—" : c[7];
    const r10 = c[8] || "";                       /* "7승0무3패" */
    const stk = /^\d+(승|패)$/.test(c[9] || "") ? c[9] : "—";  /* "3승" */
    const ten = tenFromSummary(r10);
    const key = Object.keys(TEAMKEY).find(k => team.includes(k));
    /* 추이: 이전 trend에 오늘 승률을 이어붙여 최근 8포인트 유지 */
    const prev = (prevStandings || []).find(p => p.team.includes(team.slice(0, 2)));
    const pctN = Number("0" + pct) || (w / Math.max(1, w + l));
    const trend = [...(prev?.trend || []).slice(-7), Number(pctN.toFixed(3))];
    while (trend.length < 2) trend.unshift(Number(pctN.toFixed(3)));
    return {
      rk, team: fullName(team), home: HOMECITY[Object.keys(HOMECITY).find(k => team.includes(k))] || "—",
      mine: key ? TEAMKEY[key] : null,
      w, d, l, pct, gb, ten, stk: stk === "—" ? "—" : stk.replace(/^(\d+)(승|패)$/, "$1연$2"), trend
    };
  });
}

/* "7승0무3패" → 근사 W/L 10칸 배열 (경기별 순서는 공개되지 않아 승 먼저 배치) */
function tenFromSummary(txt) {
  const m = /(\d+)승(\d+)무(\d+)패/.exec(txt);
  if (!m) return Array(10).fill("L");
  const arr = [
    ...Array(+m[1]).fill("W"),
    ...Array(+m[2]).fill("D"),
    ...Array(+m[3]).fill("L")
  ];
  while (arr.length < 10) arr.push("L");
  return arr.slice(0, 10);
}

function fullName(t) {
  const map = { "LG": "LG 트윈스", "SSG": "SSG 랜더스", "KIA": "KIA 타이거즈", "두산": "두산 베어스",
    "삼성": "삼성 라이온즈", "KT": "KT 위즈", "NC": "NC 다이노스", "롯데": "롯데 자이언츠",
    "한화": "한화 이글스", "키움": "키움 히어로즈" };
  const k = Object.keys(map).find(k => t.includes(k));
  return k ? map[k] : t;
}
