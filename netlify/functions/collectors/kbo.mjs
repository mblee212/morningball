/* KBO 공식 홈페이지 팀 순위 스크래퍼 (서버 렌더링 HTML → 안정적)
   www.koreabaseball.com/TeamRank/TeamRank.aspx
   컬럼: 순위·팀·경기·승·패·무·승률·게임차·최근10경기·연속 */

const RANK_URL = "https://www.koreabaseball.com/TeamRank/TeamRank.aspx";
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

  /* 테이블 행 파싱: <tr><td>순위</td><td>팀명</td><td>경기</td><td>승</td><td>패</td><td>무</td><td>승률</td><td>게임차</td>...<td>최근10</td><td>연속</td> */
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1].replace(/<[^>]+>/g, "").trim()))
    .filter(cells => cells.length >= 8 && /^\d+$/.test(cells[0]));
  if (rows.length !== 10) throw new Error(`순위 행 ${rows.length}개 — 페이지 구조 변경 의심`);

  return rows.map(c => {
    const rk = +c[0], team = c[1];
    const w = +c[3], l = +c[4], d = +c[5];
    const pct = c[6].startsWith("0") ? c[6].slice(1) : c[6];
    const gb = c[7] === "0.0" || c[7] === "0" ? "—" : c[7];
    /* 최근10경기 "7승0무3패" / 연속 "3승" 형태 */
    const r10 = c.find(v => /\d+승\d+무\d+패/.test(v)) || "";
    const stk = c.find((v, i) => i > 7 && /^\d+(승|패)$/.test(v)) || "—";
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
