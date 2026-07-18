/* 수동 배치 실행 (테스트·긴급 갱신용)
   사용: /.netlify/functions/run-batch?which=1&key=ADMIN_KEY
        /.netlify/functions/run-batch?which=2&key=ADMIN_KEY&force=1
   force=1 → 2배치의 시간 조건(T-90분)·기실행 여부를 무시하고 즉시 실행 */
import { runBatch1, runBatch2 } from "./_batches.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY)
    return new Response("unauthorized", { status: 401 });
  const which = url.searchParams.get("which");
  const force = url.searchParams.get("force") === "1";
  if (which === "1") return runBatch1();
  if (which === "2") return runBatch2({ force });
  return new Response("which=1 또는 which=2 필요", { status: 400 });
};
