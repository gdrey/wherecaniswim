const FAVORITES_KEY = "wherecaniswim.favoritePools.v1";
const DEFAULT_FAVORITES = ["M260", "B245", "X045"];
const SHORT_NAMES = { M164: "Asser Levy", M260: "Chelsea", M130: "Constance Baker Motley", M063: "Gertrude Ederle", M131: "Hansborough", M103: "Tony Dapolito", B270: "Brownsville", B085: "Metropolitan", B250: "Shirley Chisholm", B245: "St. John's", Q099: "Flushing Meadows", Q448: "Roy Wilkins", X045: "St. Mary's" };
function savedFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    if (Array.isArray(saved)) return new Set(saved.filter(id => typeof id === "string"));
  } catch { /* Browser storage may be unavailable. */ }
  return new Set(DEFAULT_FAVORITES);
}
const dataState = { data: null, day: "all", activity: "adult", pool: "all", favoriteMode: "all", favorites: savedFavorites() };
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
  const dates = datesInWindow(data.window_start, data.window_end);
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

function renderResults(clock = currentNYCClock()) {
  renderCurrentTime(clock);
  const sessions = visibleSessions();
  $("result-count").textContent = `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`;
  const results = $("results");
  results.replaceChildren();
  if (dataState.favoriteMode === "only" && dataState.favorites.size === 0) {
    results.className = "calendar-empty";
    results.append(el("p", "", "Choose at least one favorite pool to see its sessions."));
    return;
  }
  const dates = dataState.day === "all" ? datesInWindow(dataState.data.window_start, dataState.data.window_end) : [dataState.day];
  results.className = `calendar-grid${dates.length === 1 ? " single-day" : ""}`;
  for (const date of dates) {
    const daySessions = sessions.filter(session => session.date === date);
    const column = el("section", `calendar-day${date < clock.date ? " is-past" : ""}`);
    column.setAttribute("aria-label", formatDate(date));
    const header = el("div", "calendar-day-head");
    const dayName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T12:00:00Z`));
    header.append(el("strong", "", dayName), el("span", "", new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`))));
    column.append(header);
    const body = el("div", "calendar-day-body");
    if (daySessions.length) body.append(...daySessions.map(session => renderSession(session, clock)));
    else body.append(el("p", "calendar-no-session", "No matching sessions"));
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
  const outdated = currentNYCClock().date > data.window_start;
  status.className = `source-status${data.errors.length || data.stale || outdated ? " warning" : ""}`;
  status.replaceChildren(el("span", "status-dot"), el("span", "", `Last checked ${checked} · ${data.pools.length} pools listed · ${withSessions} with sessions · ${closed} closed${outdated ? " · awaiting today's refresh" : data.errors.length || data.stale ? " · some schedules could not be checked" : ""}`));
  $("week-label").textContent = `${formatDate(data.window_start)} – ${formatDate(data.window_end)}`;
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

async function loadSchedules() {
  if (loadingSchedules) return;
  loadingSchedules = true;
  lastDataFetchAt = Date.now();
  try {
    const response = await fetch("./data/schedules.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.pools) || !Array.isArray(data.sessions)) throw new Error("Invalid schedule data");
    dataState.data = data;
    if (dataState.day !== "all" && (dataState.day < dataState.data.window_start || dataState.day > dataState.data.window_end)) dataState.day = "all";
    $("error").hidden = true;
    renderStatus(); renderFilters(); renderResults(); renderCoverage();
  } catch {
    if (dataState.data) { dataState.data.stale = true; renderStatus(); return; }
    $("source-status").className = "source-status error-status";
    $("source-status").replaceChildren(el("span", "status-dot"), el("span", "", "Could not load published schedules"));
    $("result-count").textContent = "No live data";
    $("error").hidden = false;
    const links = $("error-links");
    const a = el("a", "", "NYC Parks indoor pools ↗");
    a.href = "https://www.nycgovparks.org/facilities/indoor-pools";
    a.target = "_blank"; a.rel = "noopener noreferrer"; links.append(a);
  } finally {
    loadingSchedules = false;
  }
}

$("clear-filters").addEventListener("click", () => {
  dataState.day = "all"; dataState.activity = "adult"; dataState.pool = "all"; dataState.favoriteMode = "all";
  if (dataState.data) { renderFilters(); renderResults(); }
});
renderCurrentTime(currentNYCClock());
function refreshClockAndSessions() {
  const clock = currentNYCClock();
  renderCurrentTime(clock);
  if (dataState.data) renderResults(clock);
  if (Date.now() - lastDataFetchAt >= 20 * 60_000) loadSchedules();
}
setInterval(refreshClockAndSessions, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshClockAndSessions(); });
loadSchedules();
