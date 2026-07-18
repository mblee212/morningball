/* 1배치 — 경기 당일 0시(KST) = 전일 15:00 UTC (netlify.toml schedule 참조) */
import { runBatch1 } from "./_batches.mjs";
export default async () => runBatch1();
