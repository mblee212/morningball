/* 모닝볼 배치 공용 라이브러리
   ─ 원칙: "검증을 통과하지 못한 데이터는 절대 저장하지 않는다"
   프런트(index.html)의 validateData와 동일한 규칙의 서버측 사본. */

export function kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000); // UTC+9
}
export function kstStamp() {
  const d = kstNow();
  const p = n => String(n).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
export function kstToday() {
  const d = kstNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/* "HH:MM"(KST 경기 시작) → 오늘 그 시각의 epoch(ms) */
export function gameStartMs(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return null;
  const d = kstNow();
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +m[1], +m[2]);
  return start - 9 * 3600 * 1000; // KST 표기 → 실제 UTC epoch
}

export function validateData(j) {
  try {
    if (!j || typeof j !== "object" || !j.teams) return false;
    const CODES = ["lg", "ob", "ssg", "kia", "ss", "kt", "nc", "lt", "hh", "wo"];
    for (const t of CODES) {
      const D = j.teams[t];
      if (!D || typeof D.name !== "string" || typeof D.short !== "string" || typeof D.record !== "string") return false;
      const G = D.game;
      if (!G) return false;
      for (const k of ["opp","oppShort","oppRec","time","venue","meta","homeSP","homeSPline","awaySP","awaySPline","verdict"])
        if (typeof G[k] !== "string" || !G[k].length) return false;
      if (!(G.playable === null || (typeof G.playable === "number" && G.playable >= 0 && G.playable <= 100))) return false;
      if (!Array.isArray(G.risks) || G.risks.length < 1 || G.risks.some(r => !r.t || !r.d || !r.lv || !r.lvt)) return false;
      const H = D.h2h;
      if (!H || !Number.isInteger(H.w) || !Number.isInteger(H.l) || !Array.isArray(H.recent) || !Array.isArray(H.bars) || H.bars.length < 1) return false;
      if (H.bars.some(b => typeof b.me !== "number" || typeof b.op !== "number" || typeof b.max !== "number" || !b.l)) return false;
      if (!Array.isArray(D.batters) || D.batters.length !== 9) return false;
      for (const b of D.batters) {
        if (!b.name || !b.key || !b.detail || !b.vsKey || !b.vsDetail || !b.adv || !b.vsAdv) return false;
        if (!Array.isArray(b.radar) || b.radar.length !== 5 || b.radar.some(v => typeof v !== "number" || v < 0 || v > 100)) return false;
      }
      const P = D.pitchers;
      if (!P || !P.starter || !Array.isArray(P.bullpen) || P.bullpen.length < 1) return false;
      for (const p of [P.starter, ...P.bullpen])
        if (!p.name || !p.key || !p.detail || !p.vsKey || !p.vsDetail || !p.adv || !p.vsAdv) return false;
      if (!P.starter.mix || !Array.isArray(P.starter.mix)) return false;
      const F = D.fun;
      if (!F || !(typeof F.winprob === "number" && F.winprob >= 0 && F.winprob <= 100)) return false;
      if (!F.keymatch || !Array.isArray(F.keymatch.stats) || !F.streak || !F.magic || !Array.isArray(F.tips) || typeof F.trivia !== "string") return false;
    }
    if (j.standings) {
      if (!Array.isArray(j.standings) || j.standings.length !== 10) return false;
      if (j.standings.some(s => !s.team || !Number.isInteger(s.w) || !Number.isInteger(s.l) || !Array.isArray(s.ten) || s.ten.length !== 10 || !Array.isArray(s.trend) || s.trend.length < 2)) return false;
    }
    if (j.news) {
      if (!Array.isArray(j.news) || j.news.length < 1) return false;
      if (j.news.some(n => !n.title || !/^https:\/\//.test(n.url || "") || !CODES.includes(n.team))) return false;
    }
    return true;
  } catch (e) { return false; }
}
