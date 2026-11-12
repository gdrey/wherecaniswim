const DIRECTORY_URL = "https://www.nycgovparks.org/facilities/indoor-pools";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BOROUGHS = { M: "Manhattan", B: "Brooklyn", Q: "Queens", X: "Bronx", R: "Staten Island" };
// Each ID was followed from the indoor-pools directory to its pool detail page and verified against its Pool schedule link.
const VERIFIED_SCHEDULE_IDS = new Set(["M164", "M260", "M130", "M063", "M131", "M103", "B270", "B085", "B250", "B245", "Q099", "Q448", "X045"]);

function nycToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayFor(iso) {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((day + 6) % 7));
}

function clean(text) {
  return text.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

export function parseDirectory(html) {
  const pools = [];
  const pattern = /<div class="poolbox[^"]*">([\s\S]*?)<p class="more-left"><a href="(\/parks\/([A-Z]\d+)\/facilities\/indoor-pools)">/g;
  for (const match of html.matchAll(pattern)) {
    const block = match[1];
    const name = clean(block.match(/<h4>([\s\S]*?)<\/h4>/)?.[1] || "");
    const location = clean(block.split(/<\/h4>/)[1]?.split(/<br\s*\/?\s*>/)[0] || "");
    if (!name || !location) throw new Error(`Missing name or location for ${match[3]}`);
    pools.push({ id: match[3], name, borough: BOROUGHS[match[3][0]] || "New York City", location, closed: /This pool is currently closed/i.test(block), detail_url: new URL(match[2], DIRECTORY_URL).href, schedule_url: null });
  }
  if (pools.length < 10 || new Set(pools.map(pool => pool.id)).size !== pools.length) throw new Error(`Indoor pool directory returned ${pools.length} unique entries`);
  return pools;
}

export function parseDetailScheduleLink(html, expectedId) {
  const links = [...html.matchAll(/href="(\/facilities\/recreationcenters\/([A-Z]\d+)\/schedule#Pool)"/g)];
  const match = links.find(item => item[2] === expectedId);
  if (!match) throw new Error(`Schedule link missing for ${expectedId}`);
  return new URL(match[1], DIRECTORY_URL).href;
}

function clockTime(raw) {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})\s*([ap])$/i);
  if (!match) throw new Error(`Unrecognized time: ${raw}`);
  const hour = Number(match[1]) % 12 + (match[3].toLowerCase() === "p" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function tagsFor(label) {
  const lower = label.toLowerCase();
  if (/learn to swim|swim team|water exercise|aerobics|hydro.fit|aquacise|aqua fitness|swim for life|children|teen|family|water polo|aquacades|swim prep/.test(lower)) return [];
  const tags = [];
  if (/adult/.test(lower) && /swim|lap/.test(lower)) tags.push("adult");
  if (/lap swim/.test(lower)) tags.push("lap");
  if (/(^|\s)(open swim|general swim)(\s|$)/.test(lower)) tags.push("open");
  return tags;
}

export function parseSchedule(html, pool, monday) {
  const section = html.split(/<div id="Pool-schedule"/)[1]?.split(/<\/table>/)[0];
  if (!section) throw new Error("Pool schedule table missing");
  const headers = [...(section.match(/<thead>[\s\S]*?<\/thead>/)?.[0] || "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(match => clean(match[1]));
  if (headers.length !== 7) throw new Error(`Expected 7 schedule days, found ${headers.length}`);
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const expected = `${DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
    if (headers[i] !== expected) throw new Error(`Date mismatch: ${headers[i]} versus ${expected}`);
  }
  const body = section.match(/<tbody[^>]*>([\s\S]*)$/)?.[1];
  if (!body) throw new Error("Schedule body missing");
  const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
  if (cells.length === 1 && /There are no programs scheduled at this time/i.test(clean(cells[0][1]))) return [];
  if (cells.length !== 7) throw new Error(`Expected 7 day cells, found ${cells.length}`);
  const sessions = [];
  cells.forEach((cell, index) => {
    const date = addDays(monday, index);
    for (const item of cell[1].matchAll(/<p class="program[^\"]*">([\s\S]*?)<\/p>/g)) {
      const content = item[1];
      const label = clean(content.match(/<a[^>]*class="program-popup"[^>]*>([\s\S]*?)<\/a>/)?.[1] || "");
      const tags = tagsFor(label);
      if (!tags.length) continue;
      const timeText = clean(content.split(/<br\s*\/?\s*>/i)[0]);
      const time = timeText.match(/^(\d{1,2}:\d{2}\s*[ap])\s*-\s*(\d{1,2}:\d{2}\s*[ap])$/i);
      if (!time) throw new Error(`Unrecognized time range: ${timeText}`);
      const start = clockTime(time[1]);
      const end = clockTime(time[2]);
      if (end <= start) throw new Error(`Invalid time range: ${timeText}`);
      const room = clean(content.match(/<span class="room">([\s\S]*?)<\/span>/)?.[1] || "");
      sessions.push({ pool_id: pool.id, pool_name: pool.name, borough: pool.borough, address: pool.location, date, start_time: start, end_time: end, activity: label, tags, room, source_url: `${pool.schedule_url.replace(/\/schedule#Pool$/, `/schedule/${monday}#Pool`)}` });
    }
  });
  return sessions;
}

async function fetchWeek(pool, monday) {
  const url = pool.schedule_url.replace(/\/schedule#Pool$/, `/schedule/${monday}`);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const html = await fetchHtml(attempt ? `${url}?check=${Date.now()}-${attempt}` : url);
      return { sessions: parseSchedule(html, pool, monday), closed_notice: /The Tony Dapolito Recreation Center and Outdoor Pool are closed/i.test(html) };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
    }
  }
  throw lastError;
}

async function fetchHtml(url) {
  let lastStatus;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT, "accept": "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(15000) });
    if (response.status === 200) return response.text();
    lastStatus = response.status;
    if (![202, 429, 500, 502, 503, 504].includes(lastStatus)) break;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1500));
  }
  throw new Error(`${url}: HTTP ${lastStatus}`);
}

async function mapSettledLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await task(items[index]) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}

export async function fetchSchedules() {
  const today = nycToday();
  const monday = mondayFor(today);
  const nextMonday = addDays(monday, 7);
  const pools = parseDirectory(await fetchHtml(DIRECTORY_URL));
  const errors = [];
  for (const pool of pools.filter(pool => VERIFIED_SCHEDULE_IDS.has(pool.id))) pool.schedule_url = new URL(`/facilities/recreationcenters/${pool.id}/schedule#Pool`, DIRECTORY_URL).href;
  const unknownPools = pools.filter(pool => !pool.schedule_url);
  const detailResults = await mapSettledLimit(unknownPools, 2, async pool => parseDetailScheduleLink(await fetchHtml(pool.detail_url), pool.id));
  detailResults.forEach((result, index) => {
    if (result.status === "fulfilled") unknownPools[index].schedule_url = result.value;
    else errors.push({ pool_id: unknownPools[index].id, stage: "detail", message: String(result.reason?.message || result.reason) });
  });
  const requests = pools.filter(pool => pool.schedule_url).flatMap(pool => [monday, nextMonday].map(week => ({ pool, week })));
  const results = await mapSettledLimit(requests, 2, ({ pool, week }) => fetchWeek(pool, week));
  const sessions = [];
  const successes = new Map();
  const closedNotices = new Set();
  results.forEach((result, index) => {
    const pool = requests[index].pool;
    if (result.status === "fulfilled") {
      successes.set(pool.id, (successes.get(pool.id) || 0) + 1);
      if (result.value.closed_notice) closedNotices.add(pool.id);
      if (!pool.closed) sessions.push(...result.value.sessions);
    } else errors.push({ pool_id: pool.id, stage: "schedule", week: requests[index].week, message: String(result.reason?.message || result.reason) });
  });
  const until = addDays(today, 6);
  const unique = new Map();
  for (const session of sessions) if (session.date >= today && session.date <= until && !closedNotices.has(session.pool_id)) {
    unique.set([session.pool_id, session.date, session.start_time, session.end_time, session.activity, session.room].join("|"), session);
  }
  const upcoming = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time) || a.pool_name.localeCompare(b.pool_name));
  for (const pool of pools) {
    pool.session_count = upcoming.filter(session => session.pool_id === pool.id).length;
    pool.status = pool.closed || closedNotices.has(pool.id) ? "closed" : !successes.has(pool.id) ? "unavailable" : errors.some(error => error.pool_id === pool.id) ? "partial" : pool.session_count === 0 ? "no_sessions" : "available";
  }
  if (!successes.size) throw new Error(`No pool schedules could be checked. ${errors.map(error => error.message).join("; ")}`);
  return { checked_at: new Date().toISOString(), window_start: today, window_end: until, directory_url: DIRECTORY_URL, pools, errors, sessions: upcoming };
}

