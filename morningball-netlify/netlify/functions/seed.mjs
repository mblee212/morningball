/* 최초 1회: 정적 data.json(시드)을 blob 저장소에 적재
   사용: /.netlify/functions/seed?key=ADMIN_KEY  (이미 데이터가 있으면 덮어쓰지 않음) */
import { getStore } from "@netlify/blobs";
import { validateData } from "./_lib.mjs";

export default async (req) => {
  const url = new URL(req.url);
  if (!process.env.ADMIN_KEY || url.searchParams.get("key") !== process.env.ADMIN_KEY)
    return new Response("unauthorized", { status: 401 });
  const store = getStore("morningball");
  if (await store.get("data", { type: "json" }))
    return new Response("이미 데이터가 존재합니다 — 시드 불필요");
  const r = await fetch(new URL("/data.json.seed", url.origin));
  if (!r.ok) return new Response("시드 파일 없음", { status: 404 });
  const j = await r.json();
  if (!validateData(j)) return new Response("시드 검증 실패", { status: 500 });
  await store.setJSON("data", { ...j, meta: { batch1: null, batch2: null, note: "seed" } });
  return new Response("seed ok");
};
