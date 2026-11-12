import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetchSchedules } from "./source.mjs";

const destination = fileURLToPath(new URL("../site/data/schedules.json", import.meta.url));
let lastError;

for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const data = await fetchSchedules();
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
