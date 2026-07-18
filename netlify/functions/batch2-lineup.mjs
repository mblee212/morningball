/* 2배치 — 30분 간격 폴링, "경기 시작 90분 전 도달" 시에만 라인업 갱신 */
import { runBatch2 } from "./_batches.mjs";
export default async () => runBatch2();
