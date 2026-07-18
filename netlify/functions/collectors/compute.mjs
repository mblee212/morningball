/* 세이버메트릭스 자체 계산 모듈
   ─ 카운팅 기록(타석·안타·볼넷·삼진 등)만으로 유도 가능한 지표를 계산한다.
   ─ 원칙: 입력이 없으면 지어내지 않고 "—" 반환 (절대 오류 금지)
   ─ wRC+는 파크팩터 미보정 버전임을 명시 (리그 상수는 KBO 팀 기록에서 매일 수집) */

const D = "—";
export const nn = v => (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) ? null : Number(v);
const f2 = v => v == null ? D : v.toFixed(2);
const f3 = v => v == null ? D : v.toFixed(3).replace(/^(-?)0/, "$1");
const pct = v => v == null ? D : (v * 100).toFixed(1) + "%";
const i0 = v => v == null ? D : String(Math.round(v));

/* IP 표기(109.2 = 109와 2/3이닝) → 실수 이닝 */
export function ipToNum(ip) {
  const n = nn(ip);
  if (n == null) return null;
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 10);
  return whole + (frac === 1 ? 1 / 3 : frac === 2 ? 2 / 3 : 0);
}

/* ── 리그 상수 (KBO 팀 기록 합산에서 산출) ── */
export function leagueConstants(bat, pit) {
  /* bat: {PA,AB,H,H2,H3,HR,BB,IBB,HBP,SO,SF,R} 리그 합계 / pit: {IP,ER,HR,BB,HBP,SO} */
  const woba = wOBAraw(bat);
  const rpa = (nn(bat?.R) != null && nn(bat?.PA)) ? bat.R / bat.PA : null;
  let cfip = null;
  const ip = ipToNum(pit?.IP);
  if (ip && [pit.ER, pit.HR, pit.BB, pit.SO].every(v => nn(v) != null)) {
    const lgERA = pit.ER * 9 / ip;
    cfip = lgERA - (13 * pit.HR + 3 * (pit.BB + (nn(pit.HBP) || 0)) - 2 * pit.SO) / ip;
  }
  return { lgWOBA: woba, lgRPA: rpa, cFIP: cfip, wobaScale: 1.15 };
}

function wOBAraw(r) {
  if (!r) return null;
  const [AB, H, H2, H3, HR, BB, HBP, SF] = [r.AB, r.H, r.H2, r.H3, r.HR, r.BB, r.HBP, r.SF].map(nn);
  if ([AB, H, HR, BB].some(v => v == null)) return null;
  const IBB = nn(r.IBB) || 0, hbp = HBP || 0, sf = SF || 0;
  const h2 = H2 || 0, h3 = H3 || 0;
  const h1 = H - h2 - h3 - HR;
  const den = AB + BB - IBB + sf + hbp;
  if (den <= 0) return null;
  return (0.69 * (BB - IBB) + 0.72 * hbp + 0.89 * h1 + 1.27 * h2 + 1.62 * h3 + 2.10 * HR) / den;
}

/* ── 타자 지표 ──
   raw: {PA,AB,H,H2,H3,HR,BB,IBB,HBP,SO,SF,SB,CS,AVG,OBP,SLG} (있는 것만) */
export function computeBatter(raw, lg = {}) {
  const [PA, AB, H, HR, BB, SO, SB] = [raw.PA, raw.AB, raw.H, raw.HR, raw.BB, raw.SO, raw.SB].map(nn);
  const HBP = nn(raw.HBP) || 0, SF = nn(raw.SF) || 0, CS = nn(raw.CS) || 0;
  const H2 = nn(raw.H2) || 0, H3 = nn(raw.H3) || 0;
  const AVG = nn(raw.AVG) ?? (AB ? H / AB : null);
  const TB = (H != null) ? (H - H2 - H3 - HR) + 2 * H2 + 3 * H3 + 4 * HR : null;
  const SLG = nn(raw.SLG) ?? ((TB != null && AB) ? TB / AB : null);
  const OBP = nn(raw.OBP) ?? ((H != null && BB != null && AB != null) ? (H + BB + HBP) / (AB + BB + HBP + SF) : null);

  const bbPct = (BB != null && PA) ? BB / PA : null;
  const kPct = (SO != null && PA) ? SO / PA : null;
  const iso = (SLG != null && AVG != null) ? SLG - AVG : null;
  const babip = (H != null && HR != null && AB != null && SO != null && (AB - SO - HR + SF) > 0)
    ? (H - HR) / (AB - SO - HR + SF) : null;
  const woba = wOBAraw({ AB, H, H2, H3, HR, BB, IBB: raw.IBB, HBP, SF });
  const wrcPlus = (woba != null && lg.lgWOBA != null && lg.lgRPA)
    ? ((woba - lg.lgWOBA) / lg.wobaScale + lg.lgRPA) / lg.lgRPA * 100 : null;

  /* RC27: 기본형 RC=(H+BB)·TB/(AB+BB), 아웃=AB−H */
  let rc27 = null;
  if (H != null && BB != null && TB != null && AB && (AB - H) > 0)
    rc27 = 27 * ((H + BB) * TB / (AB + BB)) / (AB - H);
  const gpa = (OBP != null && SLG != null) ? (1.8 * OBP + SLG) / 4 : null;
  const bbk = (BB != null && SO) ? BB / SO : null;
  const psn = (HR != null && SB != null) ? (HR + SB > 0 ? 2 * HR * SB / (HR + SB) : 0) : null;
  const abhr = (AB != null && HR) ? AB / HR : null;
  const seca = (TB != null && H != null && BB != null && SB != null && AB)
    ? (TB - H + BB + SB - CS) / AB : null;

  return {
    key: { AVG: f3(AVG), OPS: (OBP != null && SLG != null) ? f3(OBP + SLG) : D, wRCp: wrcPlus == null ? D : i0(wrcPlus) + "*" },
    detail: { wOBA: f3(woba), "BB%": pct(bbPct), "K%": pct(kPct), ISO: f3(iso), BABIP: f3(babip), "득점권": f3(nn(raw.RISP)), SB: SB == null ? D : String(SB), HR: HR == null ? D : String(HR) },
    adv: { RC27: f2(rc27), GPA: f3(gpa), "BB/K": f2(bbk), PSN: f2(psn), "AB/HR": abhr == null ? D : abhr.toFixed(1), SecA: f3(seca) }
  };
}

/* ── 투수 지표 ── raw: {IP,H,HR,BB,HBP,SO,ER,R,TBF,QS,W,L,ERA,WHIP} */
export function computePitcher(raw, lg = {}) {
  const ip = ipToNum(raw.IP);
  const [H, HR, BB, SO, ER, R, TBF] = [raw.H, raw.HR, raw.BB, raw.SO, raw.ER, raw.R, raw.TBF].map(nn);
  const HBP = nn(raw.HBP) || 0;
  const per9 = v => (v != null && ip) ? v * 9 / ip : null;
  const era = nn(raw.ERA) ?? ((ER != null && ip) ? ER * 9 / ip : null);
  const whip = nn(raw.WHIP) ?? ((H != null && BB != null && ip) ? (H + BB) / ip : null);
  const fip = (ip && [HR, BB, SO].every(v => v != null) && lg.cFIP != null)
    ? (13 * HR + 3 * (BB + HBP) - 2 * SO) / ip + lg.cFIP : null;
  const kPct = (SO != null && TBF) ? SO / TBF : null;
  const bbPct = (BB != null && TBF) ? BB / TBF : null;
  const kbb = (kPct != null && bbPct != null) ? kPct - bbPct : null;
  const kwera = kbb != null ? 5.40 - 12 * kbb : null;
  const kOverBB = (SO != null && BB) ? SO / BB : null;
  const lob = (H != null && BB != null && R != null && HR != null && (H + BB + HBP - 1.4 * HR) > 0)
    ? (H + BB + HBP - R) / (H + BB + HBP - 1.4 * HR) : null;
  const oavg = (H != null && TBF != null && (TBF - BB - HBP) > 0) ? H / (TBF - BB - HBP) : nn(raw.OAVG);

  return {
    key: { ERA: f2(era), WHIP: f2(whip), "K/9": f2(per9(SO)) },
    detail: { FIP: f2(fip), "BB/9": f2(per9(BB)), "HR/9": f2(per9(HR)), QS: nn(raw.QS) == null ? D : String(raw.QS), "피안타율": f3(oavg), "이닝": nn(raw.IP) == null ? D : String(raw.IP), "K%": pct(kPct), "BB%": pct(bbPct) },
    adv: { kwERA: f2(kwera), "K-BB%": pct(kbb), "K/BB": f2(kOverBB), "LOB%": pct(lob) }
  };
}
