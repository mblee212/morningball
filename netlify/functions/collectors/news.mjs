/* 네이버 뉴스 검색 API — 구단명 키워드, "경기 전날 00:00(KST) ~ 현재" 기사만
   필요 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET (developers.naver.com) */

const API = "https://openapi.naver.com/v1/search/news.json";
const QUERY = { lg: "LG 트윈스", ob: "두산 베어스", ssg: "SSG 랜더스", kia: "KIA 타이거즈",
  ss: "삼성 라이온즈", kt: "KT 위즈", nc: "NC 다이노스", lt: "롯데 자이언츠",
  hh: "한화 이글스", wo: "키움 히어로즈" };
const OFFICIAL = { lg: "https://www.lgtwins.com/twins/feed/news", ob: "https://www.doosanbears.com",
  ssg: "https://www.ssglanders.com/media/news", kia: "https://tigers.co.kr",
  ss: "https://www.samsunglions.com", kt: "https://www.ktwiz.co.kr", nc: "https://www.ncdinos.com",
  lt: "https://www.giants.co.kr", hh: "https://www.hanwhaeagles.co.kr", wo: "https://heroesbaseball.co.kr" };

/* 언론사 도메인 → 표시명 (미등록 도메인은 호스트명 노출) */
const PRESS = {
  "yna.co.kr": "연합뉴스", "news1.kr": "뉴스1", "newsis.com": "뉴시스",
  "osen.co.kr": "OSEN", "spotvnews.co.kr": "스포티비뉴스", "starnewskorea.com": "스타뉴스",
  "mydaily.co.kr": "마이데일리", "sportsseoul.com": "스포츠서울", "sportschosun.com": "스포츠조선",
  "sportsworldi.com": "스포츠월드", "sports.khan.co.kr": "스포츠경향", "isplus.com": "일간스포츠",
  "xportsnews.com": "엑스포츠뉴스", "sportalkorea.com": "스포탈코리아",
  "chosun.com": "조선일보", "joongang.co.kr": "중앙일보", "donga.com": "동아일보",
  "hani.co.kr": "한겨레", "khan.co.kr": "경향신문", "kmib.co.kr": "국민일보", "hankookilbo.com": "한국일보"
};

export async function getNews(kstYesterdayStartUtcMs) {
  const id = process.env.NAVER_CLIENT_ID, secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) throw new Error("NAVER_CLIENT_ID/SECRET 미설정");

  const out = [];
  for (const team of Object.keys(QUERY)) {
    const url = `${API}?query=${encodeURIComponent(QUERY[team])}&display=30&sort=date`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    let j;
    try {
      const r = await fetch(url, {
        headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
        signal: ac.signal
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      j = await r.json();
    } finally { clearTimeout(t); }

    const items = (j?.items || [])
      .filter(it => {
        const ts = Date.parse(it.pubDate);
        return Number.isFinite(ts) && ts >= kstYesterdayStartUtcMs; /* 전날 00:00 이후 */
      })
      .slice(0, 4)
      .map(it => {
        const url = it.originallink || it.link;
        let host = "";
        try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { }
        const press = PRESS[Object.keys(PRESS).find(k => host.endsWith(k))] || host || "언론사";
        return {
          team,
          press,
          time: kstLabel(Date.parse(it.pubDate)),
          official: false,
          title: clean(it.title),
          url
        };
      })
      .filter(n => /^https:\/\//.test(n.url));
    out.push(...items);
  }

  /* 구단 공식 채널 상시 링크 (전 구단) */
  for (const [team, url] of Object.entries(OFFICIAL))
    out.push({ team, press: "구단 공식 발표", time: "수시 업데이트", official: true, title: "구단 공식 뉴스·공지 모아보기", url });
  if (out.length < 3) throw new Error("수집 기사 부족 — 이전 뉴스 유지");
  return out;
}

function clean(s = "") {
  return s.replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#39;/g, "'").trim();
}
function kstLabel(utcMs) {
  const d = new Date(utcMs + 9 * 3600 * 1000);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${days[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
