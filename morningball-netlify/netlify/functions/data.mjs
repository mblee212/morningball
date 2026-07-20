/* /data.json 요청 처리 — 배치가 저장한 최신 데이터를 반환.
   저장본이 없으면 404 → 프런트는 내장 샘플로 안전하게 폴백. */
import { getStore } from "@netlify/blobs";

export default async () => {
  const store = getStore("morningball");
  const data = await store.get("data", { type: "json" });
  if (!data) return new Response("no batch data yet", { status: 404 });
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store" /* 아침 조회 시 항상 최신 배치본 */
    }
  });
};
