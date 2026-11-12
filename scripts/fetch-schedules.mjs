import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetchSchedules } from "./source.mjs";

const destination = fileURLToPath(new URL("../site/data/schedules.json", import.meta.url));
let lastError;

async function fetchCollector() {
  const response = await fetch(process.env.SWIM_SCHEDULE_FEED_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Collector returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.stale || !Array.isArray(data.pools) || !Array.isArray(data.sessions) || !Array.isArray(data.errors)) {
    throw new Error("Collector returned invalid or stale schedule data");
  }
  if (data.errors.length) throw new Error(`Collector reported ${data.errors.length} source errors`);
  if (Date.now() - Date.parse(data.checked_at) > 60 * 60 * 1000) throw new Error("Collector has not checked schedules in the past hour");
  return data;
}

for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const data = process.env.SWIM_SCHEDULE_FEED_URL ? await fetchCollector() : await fetchSchedules();
    const incomplete = data.pools.filter(pool => pool.status === "unavailable" || pool.status === "partial");
    if (incomplete.length) throw new Error(`Incomplete schedules: ${incomplete.map(pool => pool.name).join(", ")}`);
    await mkdir(fileURLToPath(new URL("../site/data/", import.meta.url)), { recursive: true });
    await writeFile(destination, `${JSON.stringify(data)}\n`);
    console.log(`Checked ${data.pools.length} indoor pools; saved ${data.sessions.length} sessions at ${data.checked_at}.`);
    lastError = null;
    break;
  } catch (error) {
    lastError = error;
    console.error(`Schedule check ${attempt}/3 failed: ${error.message}`);
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 10000));
  }
}

if (lastError) {
  console.error("Previous published schedules were left in place.");
  process.exitCode = 1;
}
