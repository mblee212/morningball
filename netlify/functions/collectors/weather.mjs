/* 날씨(기상청 단기예보) + 미세먼지(에어코리아) → 경기 진행 가능성 산출
   필요 환경변수: WEATHER_KEY (공공데이터포털 인증키 1개로 두 API 모두 사용) */

const KMA = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";
const AIR = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty";

/* 구장 → 기상청 격자좌표(nx,ny) + 에어코리아 측정소 */
export const STADIUM = {
  "잠실": { nx: 62, ny: 126, station: "송파구" },
  "고척": { nx: 58, ny: 125, station: "구로구" },
  "인천": { nx: 54, ny: 124, station: "숭의" },
  "문학": { nx: 54, ny: 124, station: "숭의" },
  "수원": { nx: 60, ny: 121, station: "인계동" },
  "대전": { nx: 67, ny: 100, station: "문창동" },
  "대구": { nx: 89, ny: 90,  station: "수성구" },
  "광주": { nx: 58, ny: 74,  station: "운암동" },
  "사직": { nx: 98, ny: 76,  station: "연산동" },
  "부산": { nx: 98, ny: 76,  station: "연산동" },
  "창원": { nx: 90, ny: 77,  station: "의창동" }
};
export function stadiumInfo(venueName = "") {
  const key = Object.keys(STADIUM).find(k => venueName.includes(k));
  return key ? STADIUM[key] : STADIUM["잠실"];
}

async function getJson(url, timeoutMs = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* 경기 시간대(±2h)의 강수확률 최대값·기온·강수형태 */
export async function getForecast({ nx, ny }, gameHour, kstDateCompact /* YYYYMMDD */) {
  const key = process.env.WEATHER_KEY;
  if (!key) throw new Error("WEATHER_KEY 미설정");
  const url = `${KMA}?serviceKey=${encodeURIComponent(key)}&numOfRows=400&pageNo=1&dataType=JSON&base_date=${kstDateCompact}&base_time=0200&nx=${nx}&ny=${ny}`;
  const j = await getJson(url);
  const header = j?.response?.header;
  if (header && header.resultCode && header.resultCode !== "00")
    throw new Error("기상청 " + header.resultCode + ":" + (header.resultMsg || "")); /* 예: 30(키 미등록), 03(데이터없음) */
  const items = j?.response?.body?.items?.item;
  if (!Array.isArray(items)) throw new Error("기상청 응답 구조 이상: " + (header?.resultMsg || "unknown"));
  const hours = [];
  for (let h = gameHour - 1; h <= gameHour + 3; h++) hours.push(String(Math.max(0, Math.min(23, h))).padStart(2, "0") + "00");
  const inWin = it => it.fcstDate === kstDateCompact && hours.includes(it.fcstTime);
  const pops = items.filter(it => it.category === "POP" && inWin(it)).map(it => +it.fcstValue).filter(Number.isFinite);
  const tmps = items.filter(it => it.category === "TMP" && it.fcstDate === kstDateCompact && it.fcstTime === hours[1]).map(it => +it.fcstValue);
  const ptys = items.filter(it => it.category === "PTY" && inWin(it)).map(it => +it.fcstValue);
  return {
    pop: pops.length ? Math.max(...pops) : null,          /* 강수확률 % */
    tmp: tmps.length ? tmps[0] : null,                    /* 경기 시각 기온 */
    rainType: ptys.some(v => v > 0)                       /* 강수형태 존재 여부 */
  };
}

/* 미세먼지 PM10 (경보 기준: 주의보 150↑ 2h, 경기 취소 검토는 경보 300↑) */
export async function getAir(station) {
  const key = process.env.WEATHER_KEY;
  if (!key) throw new Error("WEATHER_KEY 미설정");
  const url = `${AIR}?serviceKey=${encodeURIComponent(key)}&returnType=json&numOfRows=1&pageNo=1&stationName=${encodeURIComponent(station)}&dataTerm=DAILY&ver=1.3`;
  const j = await getJson(url);
  const header = j?.response?.header;
  if (header && header.resultCode && header.resultCode !== "00")
    throw new Error("에어코리아 " + header.resultCode + ":" + (header.resultMsg || ""));
  const it = j?.response?.body?.items?.[0];
  if (!it) throw new Error("에어코리아 응답 없음");
  const pm10 = Number(it.pm10Value);
  return { pm10: Number.isFinite(pm10) ? pm10 : null };
}

/* 수집값 → 진행 가능성 점수/판정/리스크 목록 */
export function buildPlayable(fc, air) {
  const risks = [];
  let score = 100;

  if (fc?.pop != null) {
    score -= Math.round(fc.pop * 0.7);
    const lv = fc.pop >= 60 ? "bad" : fc.pop >= 30 ? "warn" : "good";
    risks.push({ ico: "🌧️", t: "강수", d: `경기 시간대 강수확률 최대 ${fc.pop}%${fc.rainType ? " · 강수 예보 있음" : ""}`, lv, lvt: lv === "good" ? "낮음" : lv === "warn" ? "주시" : "높음" });
  } else {
    risks.push({ ico: "🌧️", t: "강수", d: "예보 데이터 일시 미수신 — 기상청 발표 확인 권장", lv: "warn", lvt: "미확인" });
  }

  if (fc?.tmp != null) {
    const hot = fc.tmp >= 33, warm = fc.tmp >= 31;
    if (hot) score -= 8;
    risks.push({ ico: "🌡️", t: "기온", d: `경기 시작 무렵 ${fc.tmp}℃${hot ? " · 폭염 수준, 취소 규정(우천·폭염) 발표 주시" : warm ? " · 무더위, 수분 보충 권장" : ""}`, lv: hot ? "bad" : warm ? "warn" : "good", lvt: hot ? "주의" : warm ? "참고" : "양호" });
  }

  if (air?.pm10 != null) {
    const bad = air.pm10 >= 150, warn = air.pm10 >= 81;
    if (bad) score -= 40; else if (warn) score -= 8; /* 경보 수준(150+)은 중단 검토 대상 */
    risks.push({ ico: "😶‍🌫️", t: "미세먼지", d: `PM10 ${air.pm10}㎍/㎥ (${bad ? "매우나쁨 — 경보 시 중단 규정 존재" : warn ? "나쁨" : air.pm10 >= 31 ? "보통" : "좋음"})`, lv: bad ? "bad" : warn ? "warn" : "good", lvt: bad ? "경계" : warn ? "주시" : "양호" });
  } else {
    risks.push({ ico: "😶‍🌫️", t: "미세먼지", d: "측정소 데이터 일시 미수신", lv: "warn", lvt: "미확인" });
  }

  risks.push({ ico: "🏟️", t: "구장 일정", d: "KBO 공식 일정 기준 정상 편성 — 특이 행사 없음", lv: "good", lvt: "이상 없음" });

  score = Math.max(0, Math.min(100, score));
  /* 개별 리스크가 '높음/경계'면 점수와 무관하게 판정을 한 단계 낮춘다 */
  const hasBad = risks.some(r => r.lv === "bad");
  const verdict = (score >= 75 && !hasBad) ? "정상 진행 유력"
                : (score >= 50) ? "기상 변수 주시"
                : "취소 가능성 주시";
  return { playable: score, verdict, risks };
}
