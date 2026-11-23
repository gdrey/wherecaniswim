const FAVORITES_KEY = "wherecaniswim.favoritePools.v1";
const SCHEDULE_CACHE_KEY = "wherecaniswim.lastSuccessfulSchedules.v1";
const LIVE_FEED_URL = "https://wherecaniswim-nyc-prototype.gdrey.chatgpt.site/api/sessions";
const DAILY_FEED_URL = "https://www.gadidreyfuss.com/wherecaniswim/data/schedules.json";
const DEFAULT_FAVORITES = ["M260", "B245", "X045"];
const SHORT_NAMES = { M164: "Asser Levy", M260: "Chelsea", M130: "Constance Baker Motley", M063: "Gertrude Ederle", M131: "Hansborough", M103: "Tony Dapolito", B270: "Brownsville", B085: "Metropolitan", B250: "Shirley Chisholm", B245: "St. John's", Q099: "Flushing Meadows", Q448: "Roy Wilkins", X045: "St. Mary's" };
function savedFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    if (Array.isArray(saved)) return new Set(saved.filter(id => typeof id === "string"));
  } catch { /* Browser storage may be unavailable. */ }
  return new Set(DEFAULT_FAVORITES);
}
const dataState = { data: null, day: "all", activity: "adult", pool: "all", favoriteMode: "only", favorites: savedFavorites(), refreshFailed: false };
let lastDataFetchAt = 0;
let loadingSchedules = false;
const $ = id => document.getElementById(id);
const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
const nycClockFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const nycClockLabelFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

function currentNYCClock() {
  const instant = new Date();
  const parts = Object.fromEntries(nycClockFormatter.formatToParts(instant).map(part => [part.type, part.value]));
  return { instant, date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function renderCurrentTime(clock) {
  const element = $("current-time");
  element.dateTime = clock.instant.toISOString();
  element.textContent = `Now in NYC: ${nycClockLabelFormatter.format(clock.instant)}`;
}

function sessionIsPast(session, clock) {
  return session.date < clock.date || (session.date === clock.date && session.end_time <= clock.time);
}

function formatDate(iso) { return dateFormatter.format(new Date(`${iso}T12:00:00Z`)); }
function formatShortDate(iso) {
  const parts = shortDateFormatter.formatToParts(new Date(`${iso}T12:00:00Z`));
  return `${parts.find(part => part.type === "weekday").value} ${parts.find(part => part.type === "day").value}`;
}
function formatTime(time) { return timeFormatter.format(new Date(`2000-01-01T${time}:00Z`)); }
function formatRange(start, end) {
  const from = formatTime(start);
  const to = formatTime(end);
  return from.slice(-2) === to.slice(-2) ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`;
}
function datesInWindow(start, end) {
  const dates = [];
  const current = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (current <= last) { dates.push(current.toISOString().slice(0, 10)); current.setUTCDate(current.getUTCDate() + 1); }
  return dates;
}
function calendarDates(start = currentNYCClock().date) {
  const first = new Date(`${start}T12:00:00Z`);
  const last = new Date(first);
  last.setUTCDate(first.getUTCDate() + 6);
  return datesInWindow(start, last.toISOString().slice(0, 10));
}
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }

function setOptions(id, key, options) {
  const group = $(id);
  group.replaceChildren(...options.map(([value, label]) => {
    const button = el("button", "chip", label);
    button.type = "button";
    button.dataset.value = value;
    button.setAttribute("aria-pressed", String(dataState[key] === value));
    button.addEventListener("click", () => {
      dataState[key] = value;
      if (key === "pool") dataState.favoriteMode = "all";
      if (key === "favoriteMode" && value === "only") dataState.pool = "all";
      renderFilters();
      renderResults();
    });
    return button;
  }));
}

function renderFilters() {
  const data = dataState.data;
  const dates = calendarDates();
  setOptions("activity-options", "activity", [["adult", "Adult swim"], ["lap", "Lap swim"], ["open", "Open swim"], ["all", "All types"]]);
  setOptions("day-options", "day", [["all", "Any day"], ...dates.map(date => [date, formatShortDate(date)])]);
  setOptions("favorite-mode-options", "favoriteMode", [["all", "All pools"], ["only", `★ My favorites (${dataState.favorites.size})`]]);
  setOptions("pool-options", "pool", [["all", "All pools"], ...data.pools.map(pool => [pool.id, SHORT_NAMES[pool.id] || pool.name])]);
  const options = $("favorite-options");
  options.replaceChildren(...data.pools.map(pool => {
    const label = el("label", "favorite-choice");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = dataState.favorites.has(pool.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) dataState.favorites.add(pool.id);
      else dataState.favorites.delete(pool.id);
      try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...dataState.favorites])); } catch { /* Keep favorites for this visit. */ }
      renderFilters(); renderResults();
    });
    label.append(checkbox, el("span", "", `${SHORT_NAMES[pool.id] || pool.name}${pool.status === "closed" ? " · closed" : ""}`));
    return label;
  }));
}

function visibleSessions() {
  return dataState.data.sessions.filter(session =>
    (dataState.day === "all" || session.date === dataState.day) &&
    (dataState.activity === "all" || session.tags.includes(dataState.activity)) &&
    (dataState.favoriteMode === "all" || dataState.favorites.has(session.pool_id)) &&
    (dataState.pool === "all" || session.pool_id === dataState.pool)
  );
}

function scheduleDataIsValid(data) {
  return data && Array.isArray(data.pools) && Array.isArray(data.sessions) && Array.isArray(data.errors) &&
    Number.isFinite(Date.parse(data.checked_at)) && /^\d{4}-\d{2}-\d{2}$/.test(data.window_start) && /^\d{4}-\d{2}-\d{2}$/.test(data.window_end);
}

function showScheduleData(data) {
  if (!scheduleDataIsValid(data)) return false;
  if (dataState.data && Date.parse(data.checked_at) < Date.parse(dataState.data.checked_at)) return false;
  dataState.data = data;
  if (dataState.day !== "all" && !calendarDates().includes(dataState.day)) dataState.day = "all";
  $("error").hidden = true;
  renderStatus(); renderFilters(); renderResults(); renderCoverage();
  return true;
}

function renderSession(session, clock) {
  const past = sessionIsPast(session, clock);
  const link = el("a", `calendar-session${past ? " is-past" : ""}`);
  link.dataset.pool = session.pool_id;
  link.dataset.period = Number(session.start_time.slice(0, 2)) < 12 ? "am" : "pm";
  link.href = session.source_url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `${past ? "Past session. " : ""}${session.pool_name}, ${session.activity}, ${formatRange(session.start_time, session.end_time)}. Open official schedule.`);
  link.append(el("span", "calendar-time", formatRange(session.start_time, session.end_time)));
  link.append(el("strong", "calendar-pool", SHORT_NAMES[session.pool_id] || session.pool_name));
  link.append(el("span", "calendar-activity", session.activity));
  link.append(el("span", "calendar-location", `${session.borough} · Official schedule ↗`));
  link.title = `${session.pool_name} · ${session.address}`;
  return link;
}

const TIMELINE_START = 6 * 60;
const TIMELINE_END = 22 * 60;
const PIXELS_PER_MINUTE = 0.6;
function minutes(time) { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; }

function placeOverlappingSessions(sessions) {
  const ordered = [...sessions].sort((a, b) => a.start_time.localeCompare(b.start_time) || a.end_time.localeCompare(b.end_time));
  const groups = [];
  let group = [];
  let groupEnd = -1;
  for (const session of ordered) {
    const start = minutes(session.start_time);
    if (group.length && start >= groupEnd) { groups.push(group); group = []; groupEnd = -1; }
    group.push(session);
    groupEnd = Math.max(groupEnd, minutes(session.end_time));
  }
  if (group.length) groups.push(group);
  return groups.flatMap(items => {
    const laneEnds = [];
    const placements = items.map(session => {
      const start = minutes(session.start_time);
      let lane = laneEnds.findIndex(end => end <= start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = minutes(session.end_time);
      return { session, lane };
    });
    return placements.map(({ session, lane }) => ({ session, lane, lanes: laneEnds.length }));
  });
}

function renderResults(clock = currentNYCClock()) {
  renderCurrentTime(clock);
  const dates = dataState.day === "all" ? calendarDates(clock.date) : [dataState.day];
  const data = dataState.data;
  const sessions = visibleSessions().filter(session => dates.includes(session.date) && session.date >= data.window_start && session.date <= data.window_end);
  const timelineStart = Math.min(TIMELINE_START, ...sessions.map(session => Math.floor(minutes(session.start_time) / 60) * 60));
  const timelineEnd = Math.max(TIMELINE_END, ...sessions.map(session => Math.ceil(minutes(session.end_time) / 60) * 60));
  $("result-count").textContent = `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} in last check`;
  const results = $("results");
  results.replaceChildren();
  if (dataState.favoriteMode === "only" && dataState.favorites.size === 0) {
    results.className = "calendar-empty";
    results.append(el("p", "", "Choose at least one favorite pool to see its sessions."));
    return;
  }
  results.className = `calendar-grid timeline-grid${dates.length === 1 ? " single-day" : ""}`;
  const ruler = el("div", "timeline-ruler");
  ruler.append(el("div", "timeline-ruler-head", "NYC time"));
  const ticks = el("div", "timeline-ruler-body");
  ticks.style.height = `${(timelineEnd - timelineStart) * PIXELS_PER_MINUTE}px`;
  for (let hour = timelineStart / 60; hour <= timelineEnd / 60; hour++) {
    const tick = el("span", "timeline-tick", formatTime(`${String(hour).padStart(2, "0")}:00`));
    tick.style.top = `${(hour * 60 - timelineStart) * PIXELS_PER_MINUTE}px`;
    ticks.append(tick);
  }
  ruler.append(ticks);
  results.append(ruler);
  for (const date of dates) {
    const daySessions = sessions.filter(session => session.date === date);
    const column = el("section", `calendar-day${date < clock.date ? " is-past" : ""}`);
    column.setAttribute("aria-label", formatDate(date));
    const header = el("div", "calendar-day-head");
    const dayName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T12:00:00Z`));
    header.append(el("strong", "", dayName), el("span", "", new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`))));
    column.append(header);
    const body = el("div", "calendar-day-body timeline-day-body");
    body.style.height = `${(timelineEnd - timelineStart) * PIXELS_PER_MINUTE}px`;
    if (daySessions.length) {
      for (const { session, lane, lanes } of placeOverlappingSessions(daySessions)) {
        const card = renderSession(session, clock);
        const top = (minutes(session.start_time) - timelineStart) * PIXELS_PER_MINUTE;
        const height = (minutes(session.end_time) - minutes(session.start_time)) * PIXELS_PER_MINUTE;
        card.style.top = `${top}px`;
        card.style.height = `${height}px`;
        card.style.left = `calc(${lane * 100 / lanes}% + 3px)`;
        card.style.width = `calc(${100 / lanes}% - 6px)`;
        if (height < 65 || lanes > 2) card.classList.add("compact-session");
        body.append(card);
      }
    } else {
      const covered = date >= data.window_start && date <= data.window_end;
      body.append(el("p", "calendar-no-session", covered ? "No matching sessions in last check" : "Not covered by last check"));
    }
    column.append(body);
    results.append(column);
  }
}

function renderStatus() {
  const data = dataState.data;
  const checked = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(data.checked_at));
  const withSessions = data.pools.filter(pool => pool.session_count > 0).length;
  const closed = data.pools.filter(pool => pool.status === "closed").length;
  const status = $("source-status");
  const old = Date.now() - Date.parse(data.checked_at) >= 24 * 60 * 60_000;
  const warning = dataState.refreshFailed || data.stale || old || data.errors.length > 0;
  status.className = `source-status${warning ? " warning" : ""}`;
  const note = dataState.refreshFailed || data.stale ? " · latest refresh failed; showing last checked schedules" : old ? " · check official schedules before visiting" : data.errors.length ? " · some pools could not be checked" : "";
  status.replaceChildren(el("span", "status-dot"), el("span", "", `Last successful check ${checked} · ${data.pools.length} pools listed · ${withSessions} with sessions · ${closed} closed${note}`));
  const dates = calendarDates();
  $("week-label").textContent = `${formatDate(dates[0])} – ${formatDate(dates[6])}`;
}

function renderCoverage() {
  const data = dataState.data;
  const coverage = $("coverage");
  coverage.hidden = false;
  $("coverage-summary").textContent = `All ${data.pools.length} indoor pools · source coverage`;
  const list = $("coverage-list");
  list.replaceChildren();
  const labels = { closed: "Closed", unavailable: "Schedule unavailable", partial: "Partially checked", no_sessions: "No sessions posted" };
  for (const pool of data.pools) {
    const row = el("div", "coverage-row");
    const info = el("div", "coverage-info");
    info.append(el("strong", "", pool.name), el("span", "", `${pool.borough} · ${pool.location}`));
    const status = el("span", `coverage-status ${pool.status}`, labels[pool.status] || `${pool.session_count} ${pool.session_count === 1 ? "session" : "sessions"} this week`);
    const link = el("a", "coverage-link", "Official schedule ↗");
    link.href = pool.schedule_url || pool.detail_url;
    link.target = "_blank"; link.rel = "noopener noreferrer";
    row.append(info, status, link);
    list.append(row);
  }
}

async function fetchScheduleJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!scheduleDataIsValid(data) || data.stale) throw new Error("No new schedule check was available");
    return data;
  } finally { clearTimeout(timeout); }
}

function showUnavailable() {
  $("source-status").className = "source-status error-status";
  $("source-status").replaceChildren(el("span", "status-dot"), el("span", "", "Could not load published schedules"));
  $("result-count").textContent = "No schedule data";
  $("error").hidden = false;
  const a = el("a", "", "NYC Parks indoor pools ↗");
  a.href = "https://www.nycgovparks.org/facilities/indoor-pools";
  a.target = "_blank"; a.rel = "noopener noreferrer";
  $("error-links").replaceChildren(a);
}

async function loadSchedules() {
  if (loadingSchedules) return;
  loadingSchedules = true;
  lastDataFetchAt = Date.now();
  if (!dataState.data) {
    try {
      const response = await fetch("./data/schedules.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showScheduleData(await response.json());
    } catch { /* A saved browser copy or live check may still be available. */ }
    try { showScheduleData(JSON.parse(localStorage.getItem(SCHEDULE_CACHE_KEY))); } catch { /* Browser storage may be unavailable. */ }
  }
  try {
    const data = await fetchScheduleJson(DAILY_FEED_URL, 15_000);
    dataState.refreshFailed = false;
    if (showScheduleData(data)) try { localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(data)); } catch { /* Keep schedules for this visit. */ }
    else if (dataState.data) renderStatus();
  } catch {
    dataState.refreshFailed = true;
    if (dataState.data) renderStatus();
    else showUnavailable();
  } finally { loadingSchedules = false; }
}

async function refreshSchedules() {
  const button = $("refresh-schedules");
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Checking…";
  $("refresh-message").textContent = "Checking NYC Parks now. This may take up to two minutes.";
  try {
    const data = await fetchScheduleJson(`${LIVE_FEED_URL}?refresh=1`, 120_000);
    dataState.refreshFailed = false;
    if (showScheduleData(data)) try { localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(data)); } catch { /* Keep schedules for this visit. */ }
    else if (dataState.data) renderStatus();
    $("refresh-message").textContent = data.refresh_skipped ? "A check just ran; showing its result." : data.errors.length ? `Checked, with ${data.errors.length} source errors. Check official schedules.` : "Checked NYC Parks schedules just now.";
  } catch {
    dataState.refreshFailed = true;
    if (dataState.data) renderStatus();
    else showUnavailable();
    $("refresh-message").textContent = "Could not check NYC Parks right now. Showing the last saved schedules.";
  } finally {
    button.disabled = false;
    button.textContent = "Refresh schedules";
  }
}

$("refresh-schedules").addEventListener("click", refreshSchedules);

$("clear-filters").addEventListener("click", () => {
  dataState.day = "all"; dataState.activity = "adult"; dataState.pool = "all"; dataState.favoriteMode = "only";
  if (dataState.data) { renderFilters(); renderResults(); }
});
renderCurrentTime(currentNYCClock());
let renderedCalendarDate = currentNYCClock().date;
function refreshClockAndSessions() {
  const clock = currentNYCClock();
  renderCurrentTime(clock);
  const dayChanged = clock.date !== renderedCalendarDate;
  if (dayChanged) {
    renderedCalendarDate = clock.date;
    dataState.day = "all";
    if (dataState.data) { renderStatus(); renderFilters(); }
  }
  if (dataState.data) renderResults(clock);
  if (dayChanged || Date.now() - lastDataFetchAt >= 20 * 60_000) loadSchedules();
}
setInterval(refreshClockAndSessions, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshClockAndSessions(); });
loadSchedules();
