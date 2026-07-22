const DATA_URL = "data/activities.geojson";

// Pas dit aan als je repo ergens anders staat — de fallback-link gebruikt dit
// als de 1-klik-trigger hieronder onverhoopt niet werkt.
const GITHUB_REPO = {
  owner: "Pieter2509",
  repo: "Hiking",
  workflowFile: "update-data.yml",
};

// Instellingen voor de 1-klik "Ververs data nu"-knop. workerUrl is de
// gratis Cloudflare Worker die het GitHub-token veilig achter de hand houdt
// (zie cloudflare-worker/worker.js en README.md). triggerSecret is een
// simpel wachtwoordje — dit MAG in de broncode staan, want het enige wat
// iemand hiermee kan is deze ene workflow nog eens starten.
const REFRESH_CONFIG = {
  workerUrl: "https://wandelkaart-refresh.JOUW-SUBDOMEIN.workers.dev",
  triggerSecret: "VUL-HIER-JE-EIGEN-TRIGGER-WOORD-IN",
};

const fallbackLink = document.getElementById("refresh-fallback-link");
if (fallbackLink) {
  fallbackLink.href =
    `https://github.com/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/actions/workflows/${GITHUB_REPO.workflowFile}`;
}

async function triggerRefresh() {
  const btn = document.getElementById("refresh-btn");
  const status = document.getElementById("refresh-status");
  if (!btn || !status) return;

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Bezig…";
  status.textContent = "";
  status.className = "refresh-status";

  try {
    const res = await fetch(REFRESH_CONFIG.workerUrl, {
      method: "POST",
      headers: { "X-Trigger-Secret": REFRESH_CONFIG.triggerSecret },
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      status.textContent = "Gestart! Ververs deze pagina over ongeveer een minuut voor de nieuwe data.";
      status.classList.add("refresh-status-ok");
    } else {
      console.error("Refresh-trigger mislukt:", data);
      status.textContent = "Kon de workflow niet automatisch starten — gebruik de link hieronder.";
      status.classList.add("refresh-status-error");
    }
  } catch (err) {
    console.error("Refresh-trigger mislukt:", err);
    status.textContent = "Kon de workflow niet automatisch starten — gebruik de link hieronder.";
    status.classList.add("refresh-status-error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

const refreshBtn = document.getElementById("refresh-btn");
if (refreshBtn) refreshBtn.addEventListener("click", triggerRefresh);

const fmt = new Intl.NumberFormat("nl-NL");
const fmt1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const ICON_ROUTE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19c3-1 4-4 4-7s2-6 5-6 4 3 4 6 2 6 5 6"/><circle cx="4" cy="19" r="1.4" fill="currentColor" stroke="none"/><circle cx="20" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>';

const ICON_ELEVATION =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19l5.5-9 3.5 5 3-4 6 8H3z"/></svg>';

const NORMAL_STYLE = { color: "#FFC736", weight: 3.5 };
const ACTIVE_STYLE = { color: "#3ddc59", weight: 6 };
const DEFAULT_ROUTE_COLOR = "#FFC736";

// Kleuren voor routes die je meerdere keren hebt gelopen (geel en het groen
// van de klik-selectie blijven bewust gereserveerd, dus die staan er niet in).
const ROUTE_GROUP_COLORS = [
  "#4FC3F7", // lichtblauw
  "#FF6EC7", // roze
  "#B388FF", // paars
  "#FFB74D", // oranje
  "#4DD0E1", // cyaan
  "#F06292", // rose
  "#9575CD", // indigo
  "#4DB6AC", // teal
];

// Twee wandelingen worden als "dezelfde route" gezien als (1) afstand en
// beweegtijd redelijk overeenkomen (snelle voorfilter) én (2) het volledige
// pad overlapt: minstens X% van de steekproefpunten van route A ligt binnen
// een smalle corridor van route B, en omgekeerd. Zonder die tweede check
// zouden twee heel verschillende wandelingen die toevallig bij jou thuis
// beginnen en eindigen (maar een andere kant op lopen) al snel als
// "dezelfde route" gelden.
const ROUTE_MATCH = {
  distanceRatio: 0.15,
  distanceAbsM: 500,
  timeRatio: 0.25,
  timeAbsS: 10 * 60,
  overlapSamples: 24,
  overlapCorridorM: 45,
  overlapThreshold: 0.85,
};

function withinTolerance(a, b, ratio, abs) {
  const avg = (a + b) / 2;
  return Math.abs(a - b) <= Math.max(abs, ratio * avg);
}

function metersBetween(lat1, lon1, lat2, lon2) {
  return haversineKm(lat1, lon1, lat2, lon2) * 1000;
}

function sampleCoords(coords, numSamples) {
  if (coords.length <= numSamples) return coords;
  const samples = [];
  for (let i = 0; i < numSamples; i++) {
    const idx = Math.round((i / (numSamples - 1)) * (coords.length - 1));
    samples.push(coords[idx]);
  }
  return samples;
}

function minDistanceToCoordsM(lon, lat, coords) {
  let min = Infinity;
  for (const [clon, clat] of coords) {
    const d = metersBetween(lat, lon, clat, clon);
    if (d < min) min = d;
    if (min < 1) break; // al zo goed als identiek, geen zin om verder te zoeken
  }
  return min;
}

function coverageRatio(samples, coords, corridorM) {
  let matched = 0;
  for (const [lon, lat] of samples) {
    if (minDistanceToCoordsM(lon, lat, coords) <= corridorM) matched++;
  }
  return matched / samples.length;
}

// Beide kanten op controleren: anders zou een kort stukje van een lange
// route al als "dezelfde route" tellen.
function isSameRoute(a, b) {
  const forward = coverageRatio(a.samples, b.coords, ROUTE_MATCH.overlapCorridorM);
  if (forward < ROUTE_MATCH.overlapThreshold) return false;
  const backward = coverageRatio(b.samples, a.coords, ROUTE_MATCH.overlapCorridorM);
  return backward >= ROUTE_MATCH.overlapThreshold;
}

// Groepeert wandelingen die daadwerkelijk hetzelfde pad volgen. Geeft alleen
// groepen terug met 2 of meer wandelingen (echte herhalingen). Elke groep
// vergelijkt steeds met haar allereerste lid (niet met een voortschrijdend
// gemiddelde) — anders kan een groep langzaam "wegdrijven" en uiteindelijk
// compleet andere routes gaan samenvoegen.
function groupRepeatedRoutes(features) {
  const groups = [];

  for (const f of features) {
    const distanceM = f.properties.distance_m;
    const movingTimeS = f.properties.moving_time_s;
    const coords = f.geometry && f.geometry.coordinates;
    if (!distanceM || !movingTimeS || !coords || coords.length < 2) continue;

    const candidate = { coords, samples: sampleCoords(coords, ROUTE_MATCH.overlapSamples) };

    const match = groups.find((g) => {
      const distOk = withinTolerance(g.distanceM, distanceM, ROUTE_MATCH.distanceRatio, ROUTE_MATCH.distanceAbsM);
      const timeOk = withinTolerance(g.movingTimeS, movingTimeS, ROUTE_MATCH.timeRatio, ROUTE_MATCH.timeAbsS);
      if (!distOk || !timeOk) return false; // snelle voorfilter, voorkomt onnodig dure padvergelijking
      return isSameRoute(g.reference, candidate);
    });

    if (match) {
      match.members.push(f);
    } else {
      groups.push({ distanceM, movingTimeS, reference: candidate, members: [f] });
    }
  }

  return groups.filter((g) => g.members.length > 1);
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function routeGlowFilter(hex) {
  return `drop-shadow(0 0 2px ${hexToRgba(hex, 0.9)}) drop-shadow(0 0 6px ${hexToRgba(hex, 0.45)})`;
}

// Zet een ISO-landcode (bijv. "nl") om in een vlagemoji (🇳🇱). Werkt puur op
// de landcode, niet op de (taalafhankelijke) naam, dus altijd betrouwbaar.
function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "";
  const codePoints = [...countryCode.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Bouwt een klein hoogteprofiel-lijngrafiekje (SVG) voor in de kaart-popup.
function buildElevationSparkline(profile) {
  if (!profile || profile.length < 2) return "";

  const width = 220;
  const height = 46;
  const pad = 2;
  const elevations = profile.map((p) => p[1]);
  const minE = Math.min(...elevations);
  const maxE = Math.max(...elevations);
  const range = Math.max(1, maxE - minE);
  const n = profile.length;

  const toXY = (i) => {
    const x = pad + (i / (n - 1)) * (width - pad * 2);
    const y = height - pad - ((profile[i][1] - minE) / range) * (height - pad * 2);
    return [x, y];
  };

  const linePoints = [];
  for (let i = 0; i < n; i++) linePoints.push(toXY(i));
  const lineStr = linePoints.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const baseline = (height - pad).toFixed(1);
  const areaPath = `M${linePoints[0][0].toFixed(1)},${baseline} L${lineStr.split(" ").join(" L")} L${linePoints[n - 1][0].toFixed(1)},${baseline} Z`;

  return (
    `<svg class="elevation-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">` +
    `<path d="${areaPath}" fill="rgba(255,199,54,0.18)" stroke="none"/>` +
    `<polyline points="${lineStr}" fill="none" stroke="#FFC736" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` +
    `</svg>`
  );
}

// Pas deze twee punten aan om een andere virtuele tocht te tekenen.
const JOURNEY = {
  startName: "Stein, Limburg",
  startLat: 50.9667,
  startLon: 5.7667,
  endName: "Boedapest, Hongarije",
  endLat: 47.4979,
  endLon: 19.0402,
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return R * c;
}

const MAX_LEGEND_GROUPS = 5;

function renderRouteLegend(groups, routeColorByGroup, isolatedGroup, onToggle, expanded, onToggleExpand) {
  const container = document.getElementById("legend-groups");
  container.innerHTML = "";
  if (groups.length === 0) return;

  const shown = expanded ? groups : groups.slice(0, MAX_LEGEND_GROUPS);
  for (const g of shown) {
    const color = routeColorByGroup.get(g);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "legend-item legend-item-clickable";
    if (g === isolatedGroup) item.classList.add("legend-item-active");
    item.innerHTML = `<i class="swatch" style="background:${color};box-shadow:0 0 4px ${hexToRgba(color, 0.8)}"></i>×${g.members.length}`;
    item.title = "Klik om alleen deze route te tonen op de kaart";
    item.addEventListener("click", () => onToggle(g));
    container.appendChild(item);
  }

  if (groups.length > MAX_LEGEND_GROUPS) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "legend-item legend-item-clickable legend-more";
    toggle.textContent = expanded ? "toon minder" : `+${groups.length - MAX_LEGEND_GROUPS} meer`;
    toggle.addEventListener("click", () => onToggleExpand());
    container.appendChild(toggle);
  }
}

function renderJourney(features) {
  const journeyKm = haversineKm(JOURNEY.startLat, JOURNEY.startLon, JOURNEY.endLat, JOURNEY.endLon);
  const totalKm = features.reduce((s, f) => s + (f.properties.distance_m || 0), 0) / 1000;

  const laps = Math.floor(totalKm / journeyKm);
  const remainderKm = totalKm - laps * journeyKm;
  const percent = journeyKm > 0 ? Math.min(100, (remainderKm / journeyKm) * 100) : 0;
  const toGoKm = Math.max(0, journeyKm - remainderKm);

  document.getElementById("journey-fill").style.width = `${percent}%`;
  document.getElementById("journey-walker").style.left = `${percent}%`;
  document.querySelector(".journey-start").textContent = JOURNEY.startName;
  document.querySelector(".journey-end").textContent = JOURNEY.endName;

  const lapsText = laps > 0
    ? `Je hebt deze route al <strong>${laps}×</strong> volgelopen, en zit nu op `
    : "Je zit op ";

  document.getElementById("journey-caption").innerHTML =
    `${lapsText}<strong>${fmt1.format(remainderKm)} km</strong> van de ${fmt1.format(journeyKm)} km ` +
    `tussen ${JOURNEY.startName} en ${JOURNEY.endName} — nog <strong>${fmt1.format(toGoKm)} km</strong> te gaan.`;
}

function km(meters) { return meters / 1000; }

// Meerdere tochten op dezelfde dag tellen samen (bijv. ochtend- en avondwandeling).
// De datum komt uit Strava's lokale tijd, dus dit weekt netjes per kalenderdag.
function computeDayTotals(features) {
  const dayTotals = new Map();
  for (const f of features) {
    if (!f.properties.date) continue;
    const key = new Date(f.properties.date).toISOString().slice(0, 10);
    dayTotals.set(key, (dayTotals.get(key) || 0) + (f.properties.distance_m || 0));
  }
  return dayTotals;
}

function initMap() {
  const map = L.map("map", { scrollWheelZoom: true, worldCopyJump: true }).setView([20, 10], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
    crossOrigin: true,
  }).addTo(map);
  return map;
}

// Retourneert een stijl-functie die de kleur van elke wandeling opzoekt in
// routeColorByFeature (herhaalde route = eigen kleur, anders standaard geel).
function makeStyleForFeature(routeColorByFeature) {
  return function (feature) {
    const color = routeColorByFeature.get(feature) || DEFAULT_ROUTE_COLOR;
    return { color, weight: NORMAL_STYLE.weight, opacity: 0.95 };
  };
}

function renderStats(features) {
  const totalDistanceM = features.reduce((s, f) => s + (f.properties.distance_m || 0), 0);
  const totalElevation = features.reduce((s, f) => s + (f.properties.elevation_gain_m || 0), 0);
  const count = features.length;

  // Uniek per landcode (met naam-fallback voor het geval de code ontbreekt).
  const countryMap = new Map();
  for (const f of features) {
    const p = f.properties;
    if (!p.country) continue;
    const key = p.country_code || p.country;
    if (!countryMap.has(key)) countryMap.set(key, { name: p.country, code: p.country_code });
  }

  const currentYear = new Date().getFullYear();
  const thisYearDistanceM = features
    .filter((f) => f.properties.date && new Date(f.properties.date).getFullYear() === currentYear)
    .reduce((s, f) => s + (f.properties.distance_m || 0), 0);

  let longest = null;
  for (const f of features) {
    if (!longest || (f.properties.distance_m || 0) > (longest.properties.distance_m || 0)) longest = f;
  }

  const dayTotals = computeDayTotals(features);
  let bestDayKey = null;
  let bestDayDistanceM = 0;
  for (const [key, distanceM] of dayTotals) {
    if (distanceM > bestDayDistanceM) {
      bestDayDistanceM = distanceM;
      bestDayKey = key;
    }
  }

  // Snelheid: gewogen gemiddelde (totale afstand / totale beweegtijd) is
  // representatiever dan het gemiddelde van losse tocht-snelheden.
  let movingDistanceM = 0;
  let movingTimeS = 0;
  let fastest = null;
  let fastestKmh = 0;
  for (const f of features) {
    const d = f.properties.distance_m || 0;
    const t = f.properties.moving_time_s || 0;
    if (d <= 0 || t <= 0) continue;
    movingDistanceM += d;
    movingTimeS += t;
    const kmh = (d / t) * 3.6;
    if (kmh > fastestKmh) {
      fastestKmh = kmh;
      fastest = f;
    }
  }
  const avgKmh = movingTimeS > 0 ? (movingDistanceM / movingTimeS) * 3.6 : 0;

  document.getElementById("stat-total-distance").textContent = fmt.format(Math.round(km(totalDistanceM)));
  document.getElementById("stat-total-walks").textContent = fmt.format(count);
  document.getElementById("stat-total-countries").textContent = fmt.format(countryMap.size);

  document.getElementById("card-distance").textContent = fmt1.format(km(totalDistanceM));
  document.getElementById("card-elevation").textContent = fmt.format(Math.round(totalElevation));
  document.getElementById("card-count").textContent = fmt.format(count);

  if (longest) {
    document.getElementById("card-longest").textContent = fmt1.format(km(longest.properties.distance_m)) + " km";
    document.getElementById("card-longest-name").textContent = longest.properties.name || "—";
  }

  if (bestDayKey) {
    document.getElementById("card-daymax").textContent = fmt1.format(km(bestDayDistanceM)) + " km";
    document.getElementById("card-daymax-date").textContent = new Date(bestDayKey + "T00:00:00Z")
      .toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" });
  }

  document.getElementById("card-countries").textContent = fmt.format(countryMap.size);
  document.getElementById("card-countries-list").textContent =
    [...countryMap.values()].slice(0, 4).map((c) => `${flagEmoji(c.code)} ${c.name}`.trim()).join(", ") || "—";

  document.getElementById("card-year").textContent = fmt1.format(km(thisYearDistanceM));
  document.getElementById("card-year-label").textContent = currentYear;

  document.getElementById("card-speed-avg").textContent = avgKmh > 0 ? fmt1.format(avgKmh) : "–";

  if (fastest) {
    document.getElementById("card-speed-max").textContent = fmt1.format(fastestKmh) + " km/u";
    document.getElementById("card-speed-max-name").textContent = fastest.properties.name || "—";
  }
}

const HEATMAP_WEEKS = 53;
const MONTH_NAMES_SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function buildHeatmapWeeks(numWeeks) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSinceMonday = (today.getDay() + 6) % 7; // maandag = 0
  const thisWeekSunday = new Date(today);
  thisWeekSunday.setDate(today.getDate() + (6 - daysSinceMonday));

  const start = new Date(thisWeekSunday);
  start.setDate(start.getDate() - (numWeeks * 7 - 1));

  const weeks = [];
  const cursor = new Date(start);
  for (let w = 0; w < numWeeks; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function heatLevel(distanceM, maxDistanceM) {
  if (!distanceM || maxDistanceM <= 0) return 0;
  const ratio = distanceM / maxDistanceM;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function renderHeatmap(features) {
  const dayTotals = computeDayTotals(features);
  const maxDistanceM = Math.max(0, ...dayTotals.values());
  const weeks = buildHeatmapWeeks(HEATMAP_WEEKS);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const grid = document.getElementById("heatmap-grid");
  const monthsRow = document.getElementById("heatmap-months");
  grid.innerHTML = "";
  monthsRow.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${weeks.length}, 11px)`;
  monthsRow.style.gridTemplateColumns = `repeat(${weeks.length}, 11px)`;

  let lastMonth = -1;
  weeks.forEach((week) => {
    const firstOfMonthDay = week.find((d) => d.getDate() === 1) || week[0];
    const monthLabel = document.createElement("span");
    if (firstOfMonthDay.getMonth() !== lastMonth && week.some((d) => d.getDate() <= 7)) {
      monthLabel.textContent = MONTH_NAMES_SHORT[firstOfMonthDay.getMonth()];
      lastMonth = firstOfMonthDay.getMonth();
    }
    monthsRow.appendChild(monthLabel);
  });

  for (let d = 0; d < 7; d++) {
    for (const week of weeks) {
      const date = week[d];
      const cell = document.createElement("span");
      cell.className = "heat-cell";
      if (date > today) {
        cell.classList.add("heat-future");
      } else {
        const key = date.toISOString().slice(0, 10);
        const distanceM = dayTotals.get(key) || 0;
        const level = heatLevel(distanceM, maxDistanceM);
        cell.classList.add(`level-${level}`);
        const dateLabel = date.toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" });
        cell.title = distanceM > 0
          ? `${dateLabel}: ${fmt1.format(km(distanceM))} km`
          : `${dateLabel}: geen wandeling`;
      }
      grid.appendChild(cell);
    }
  }
}

const RECORD_ICONS = {
  distance: ICON_ROUTE,
  elevation: ICON_ELEVATION,
  day:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
};

// Een verbetering telt alleen als "record" als hij er genoeg uitspringt —
// anders wordt elke vroege wandeling (zonder vergelijkingsmateriaal) al snel
// een schijnbaar record. De allereerste wandeling zet alleen de nulmeting
// neer en verschijnt zelf niet als record.
const RECORD_MIN_IMPROVEMENT = {
  distanceM: 1000, // minstens 1 km verder dan het vorige record
  elevationM: 30,   // minstens 30 hoogtemeters meer
  dayM: 1000,       // minstens 1 km meer op één dag
};

function computeRecordsTimeline(features) {
  const sorted = [...features]
    .filter((f) => f.properties.date)
    .sort((a, b) => new Date(a.properties.date) - new Date(b.properties.date));

  const records = [];
  let bestDistanceM = 0;
  let bestElevationM = 0;
  let bestDayM = 0;
  const dayTotals = new Map();

  for (const f of sorted) {
    const p = f.properties;
    const distanceM = p.distance_m || 0;
    const elevationM = p.elevation_gain_m || 0;
    const dayKey = new Date(p.date).toISOString().slice(0, 10);
    const newDayTotalM = (dayTotals.get(dayKey) || 0) + distanceM;
    dayTotals.set(dayKey, newDayTotalM);

    if (distanceM > bestDistanceM) {
      const isBaseline = bestDistanceM === 0;
      if (!isBaseline && distanceM - bestDistanceM >= RECORD_MIN_IMPROVEMENT.distanceM) {
        records.push({
          date: p.date,
          type: "distance",
          text: `Langste wandeling: <strong>${fmt1.format(km(distanceM))} km</strong>${p.name ? ` — ${p.name}` : ""}`,
        });
      }
      bestDistanceM = distanceM;
    }
    if (elevationM > bestElevationM) {
      const isBaseline = bestElevationM === 0;
      if (!isBaseline && elevationM - bestElevationM >= RECORD_MIN_IMPROVEMENT.elevationM) {
        records.push({
          date: p.date,
          type: "elevation",
          text: `Meeste hoogtemeters in één tocht: <strong>${fmt.format(Math.round(elevationM))} m</strong>${p.name ? ` — ${p.name}` : ""}`,
        });
      }
      bestElevationM = elevationM;
    }
    if (newDayTotalM > bestDayM) {
      const isBaseline = bestDayM === 0;
      if (!isBaseline && newDayTotalM - bestDayM >= RECORD_MIN_IMPROVEMENT.dayM) {
        records.push({
          date: p.date,
          type: "day",
          text: `Meeste kilometers op één dag: <strong>${fmt1.format(km(newDayTotalM))} km</strong>`,
        });
      }
      bestDayM = newDayTotalM;
    }
  }

  return records.reverse(); // meest recente record eerst
}

function renderRecords(features) {
  const records = computeRecordsTimeline(features);
  const list = document.getElementById("records-list");
  list.innerHTML = "";

  if (records.length === 0) {
    list.innerHTML = '<li class="record-empty">Nog geen records — je eerste wandeling telt al als startpunt.</li>';
    return;
  }

  for (const r of records) {
    const li = document.createElement("li");
    li.className = "record-item";
    const dateLabel = new Date(r.date).toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" });
    li.innerHTML = `
      <span class="record-icon">${RECORD_ICONS[r.type]}</span>
      <span class="record-text">${r.text}</span>
      <span class="record-date">${dateLabel}</span>
    `;
    list.appendChild(li);
  }
}

const SORTERS = {
  "date-desc": (a, b) => dateValue(b) - dateValue(a),
  "date-asc": (a, b) => dateValue(a) - dateValue(b),
  "distance-desc": (a, b) => (b.properties.distance_m || 0) - (a.properties.distance_m || 0),
  "distance-asc": (a, b) => (a.properties.distance_m || 0) - (b.properties.distance_m || 0),
  "elevation-desc": (a, b) => (b.properties.elevation_gain_m || 0) - (a.properties.elevation_gain_m || 0),
  "elevation-asc": (a, b) => (a.properties.elevation_gain_m || 0) - (b.properties.elevation_gain_m || 0),
};

function dateValue(feature) {
  return feature.properties.date ? new Date(feature.properties.date).getTime() : 0;
}

function renderList(features, listItemByFeature, onSelect, sortKey, activeFeature, searchTerm) {
  const list = document.getElementById("walk-list");
  list.innerHTML = "";
  listItemByFeature.clear();

  const term = (searchTerm || "").trim().toLowerCase();
  const filtered = term
    ? features.filter((f) => {
        const name = (f.properties.name || "").toLowerCase();
        const country = (f.properties.country || "").toLowerCase();
        return name.includes(term) || country.includes(term);
      })
    : features;

  const sorter = SORTERS[sortKey] || SORTERS["date-desc"];
  const sorted = [...filtered].sort(sorter);

  if (sorted.length === 0) {
    list.innerHTML = '<li class="record-empty">Geen wandelingen gevonden voor deze zoekopdracht.</li>';
    return;
  }

  for (const f of sorted) {
    const li = document.createElement("li");
    li.className = "walk-item";
    li.tabIndex = 0;

    const date = f.properties.date ? new Date(f.properties.date) : null;
    const day = date ? date.getDate() : "–";
    const month = date ? date.toLocaleDateString("nl-NL", { month: "short" }).replace(".", "") : "";

    li.innerHTML = `
      <div class="walk-date-badge">
        <span class="day">${day}</span>
        <span class="month">${month}</span>
      </div>
      <div class="walk-main">
        <span class="walk-name">${f.properties.name || "Naamloze wandeling"}</span>
        <span class="walk-meta">${flagEmoji(f.properties.country_code)} ${f.properties.country || "onbekend land"}</span>
      </div>
      <div class="walk-metrics">
        <span class="metric">${ICON_ROUTE}${fmt1.format(km(f.properties.distance_m || 0))} km</span>
        <span class="metric">${ICON_ELEVATION}+${fmt.format(Math.round(f.properties.elevation_gain_m || 0))} m</span>
      </div>
    `;

    listItemByFeature.set(f, li);
    if (f === activeFeature) li.classList.add("walk-item-active");

    const activate = () => onSelect(f, { fit: true });
    li.addEventListener("click", activate);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });

    list.appendChild(li);
  }
}

function showSnapshotToast(message) {
  const toast = document.getElementById("snapshot-toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showSnapshotToast._t);
  showSnapshotToast._t = setTimeout(() => toast.classList.remove("visible"), 4000);
}

async function shareMapSnapshot() {
  const mapEl = document.getElementById("map");
  const btn = document.getElementById("snapshot-btn");
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Bezig…";

  try {
    const canvas = await html2canvas(mapEl, { useCORS: true, logging: false });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("kon geen afbeelding maken");

    const file = new File([blob], "wandelkaart.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Mijn wandelkaart" });
        return;
      } catch (shareErr) {
        if (shareErr && shareErr.name === "AbortError") return; // gebruiker annuleerde zelf
        // anders: val terug op downloaden hieronder
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "wandelkaart.png";
    link.click();
    URL.revokeObjectURL(url);
    showSnapshotToast("Afbeelding gedownload.");
  } catch (err) {
    console.error("Snapshot mislukt:", err);
    showSnapshotToast("Kon geen afbeelding maken van de kaart. Gebruik de schermafbeelding-functie van je apparaat.");
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function main() {
  const map = initMap();

  let geojson;
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error("geen data gevonden");
    geojson = await res.json();
  } catch (err) {
    console.warn("Kon activiteiten-data niet laden, toon lege staat:", err);
    geojson = { type: "FeatureCollection", features: [] };
  }

  const features = geojson.features || [];
  const layerByFeature = new Map();
  const listItemByFeature = new Map();
  let activeFeature = null;
  let isolatedGroup = null;
  let legendExpanded = false;
  let timelineThresholdDate = null;

  // Wandelingen met een vergelijkbare afstand én beweegtijd worden als
  // "dezelfde route" gezien en krijgen een eigen kleur op de kaart.
  const repeatGroups = groupRepeatedRoutes(features);
  const routeColorByFeature = new Map();
  const routeColorByGroup = new Map();
  const groupByFeature = new Map();
  repeatGroups.forEach((g, i) => {
    const color = ROUTE_GROUP_COLORS[i % ROUTE_GROUP_COLORS.length];
    routeColorByGroup.set(g, color);
    for (const f of g.members) {
      routeColorByFeature.set(f, color);
      groupByFeature.set(f, g);
    }
  });

  // Past de zichtbaarheid van elke route aan op basis van een eventueel
  // geïsoleerde routegroep (legenda-klik) én een eventuele tijdlijn-drempel.
  function refreshMapVisibility() {
    for (const [feature, layer] of layerByFeature) {
      const el = layer.getElement();
      if (!el) continue;
      const passesGroup = !isolatedGroup || isolatedGroup.members.includes(feature);
      const passesTimeline =
        !timelineThresholdDate ||
        (feature.properties.date && new Date(feature.properties.date) <= timelineThresholdDate);
      el.style.opacity = passesGroup && passesTimeline ? "1" : "0.12";
    }
  }

  function toggleIsolatedGroup(group) {
    isolatedGroup = isolatedGroup === group ? null : group;
    refreshMapVisibility();
    if (isolatedGroup) {
      for (const f of isolatedGroup.members) {
        const layer = layerByFeature.get(f);
        if (layer) layer.bringToFront();
      }
    }
    renderRouteLegend(repeatGroups, routeColorByGroup, isolatedGroup, toggleIsolatedGroup, legendExpanded, toggleLegendExpanded);
  }

  function toggleLegendExpanded() {
    legendExpanded = !legendExpanded;
    renderRouteLegend(repeatGroups, routeColorByGroup, isolatedGroup, toggleIsolatedGroup, legendExpanded, toggleLegendExpanded);
  }

  renderRouteLegend(repeatGroups, routeColorByGroup, isolatedGroup, toggleIsolatedGroup, legendExpanded, toggleLegendExpanded);

  function applyLayerStyle(layer, active, feature) {
    const baseColor = routeColorByFeature.get(feature) || DEFAULT_ROUTE_COLOR;
    layer.setStyle(active ? ACTIVE_STYLE : { color: baseColor, weight: NORMAL_STYLE.weight });
    if (active) layer.bringToFront(); // anders kan een overlappende route de groene highlight verbergen
    const el = layer.getElement();
    if (!el) return;
    el.classList.toggle("walked-route-active", active);
    el.style.filter = active ? "" : routeGlowFilter(baseColor);
  }

  // Selectie blijft staan tot een andere tocht of de kaart zelf wordt aangeklikt.
  function selectFeature(feature, { fit = false } = {}) {
    if (activeFeature === feature) {
      if (fit) {
        const layer = layerByFeature.get(feature);
        if (layer) map.fitBounds(layer.getBounds(), { maxZoom: 13 });
      }
      return;
    }

    if (activeFeature) {
      const prevLayer = layerByFeature.get(activeFeature);
      if (prevLayer) applyLayerStyle(prevLayer, false, activeFeature);
      const prevItem = listItemByFeature.get(activeFeature);
      if (prevItem) prevItem.classList.remove("walk-item-active");
    }

    activeFeature = feature;

    if (feature) {
      const layer = layerByFeature.get(feature);
      if (layer) {
        applyLayerStyle(layer, true, feature);
        if (fit) map.fitBounds(layer.getBounds(), { maxZoom: 13 });
      }
      const item = listItemByFeature.get(feature);
      if (item) item.classList.add("walk-item-active");
    }
  }

  const geoLayer = L.geoJSON(geojson, {
    style: makeStyleForFeature(routeColorByFeature),
    onEachFeature: (feature, layer) => {
      layerByFeature.set(feature, layer);
      const p = feature.properties;
      const group = groupByFeature.get(feature);
      const repeatLine = group ? `<br><em>${group.members.length}× gelopen op deze route</em>` : "";
      const sparkline = p.elevation_profile ? `<div class="popup-elevation">${buildElevationSparkline(p.elevation_profile)}</div>` : "";
      layer.bindPopup(
        `<strong>${p.name || "Wandeling"}</strong><br>` +
        `${p.date ? new Date(p.date).toLocaleDateString("nl-NL") : ""}<br>` +
        `${fmt1.format(km(p.distance_m || 0))} km · +${fmt.format(Math.round(p.elevation_gain_m || 0))} m` +
        repeatLine + sparkline
      );
      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e); // voorkomt dat de klik ook de kaart-klik (= deselecteren) triggert
        selectFeature(feature, { fit: false });
      });
    },
  }).addTo(map);

  // Glow-kleur per route toepassen nu de SVG-elementen daadwerkelijk bestaan.
  for (const [feature, layer] of layerByFeature) {
    applyLayerStyle(layer, false, feature);
  }

  // Klikken op de lege kaart heft de selectie op — maar een klik die vlak na
  // een zoom/pan-actie binnenkomt (bijv. via scroll-zoom) wordt genegeerd,
  // anders verspringt de selectie al bij het scrollen/zoomen zelf.
  let suppressNextMapClick = false;
  map.on("zoomstart movestart", () => { suppressNextMapClick = true; });
  map.on("zoomend moveend", () => { setTimeout(() => { suppressNextMapClick = false; }, 80); });
  map.on("click", () => {
    if (suppressNextMapClick) return;
    selectFeature(null);
    if (isolatedGroup) toggleIsolatedGroup(isolatedGroup);
  });

  if (features.length > 0) {
    map.fitBounds(geoLayer.getBounds(), { padding: [30, 30] });
  }

  renderStats(features);
  renderJourney(features);
  renderHeatmap(features);
  renderRecords(features);

  let currentSort = "date-desc";
  let currentSearch = "";
  renderList(features, listItemByFeature, selectFeature, currentSort, activeFeature, currentSearch);

  const sortSelect = document.getElementById("sort-select");
  sortSelect.addEventListener("change", (e) => {
    currentSort = e.target.value;
    renderList(features, listItemByFeature, selectFeature, currentSort, activeFeature, currentSearch);
  });

  const searchInput = document.getElementById("log-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      currentSearch = e.target.value;
      renderList(features, listItemByFeature, selectFeature, currentSort, activeFeature, currentSearch);
    });
  }

  document.getElementById("snapshot-btn").addEventListener("click", shareMapSnapshot);

  // Route-reveal tijdlijn: laat zien hoe de kaart zich in de tijd heeft opgebouwd.
  const timelineDates = [...new Set(features.map((f) => f.properties.date).filter(Boolean))].sort(
    (a, b) => new Date(a) - new Date(b)
  );
  const timelineSection = document.getElementById("timeline-section");
  if (timelineDates.length > 1 && timelineSection) {
    const slider = document.getElementById("timeline-slider");
    const dateLabel = document.getElementById("timeline-date");
    const playBtn = document.getElementById("timeline-play");
    const resetBtn = document.getElementById("timeline-reset");
    const lastIdx = timelineDates.length - 1;

    slider.max = String(lastIdx);
    slider.value = String(lastIdx);
    dateLabel.textContent = "nu";

    const applyTimelineIndex = (idx) => {
      if (idx >= lastIdx) {
        timelineThresholdDate = null;
        dateLabel.textContent = "nu";
      } else {
        timelineThresholdDate = new Date(timelineDates[idx]);
        dateLabel.textContent = timelineThresholdDate.toLocaleDateString("nl-NL", {
          day: "2-digit", month: "short", year: "numeric",
        });
      }
      refreshMapVisibility();
    };

    slider.addEventListener("input", () => applyTimelineIndex(Number(slider.value)));

    resetBtn.addEventListener("click", () => {
      slider.value = String(lastIdx);
      applyTimelineIndex(lastIdx);
    });

    let playTimer = null;
    playBtn.addEventListener("click", () => {
      if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
        playBtn.textContent = "▶ Afspelen";
        return;
      }
      slider.value = "0";
      applyTimelineIndex(0);
      playBtn.textContent = "⏸ Stop";
      const stepMs = Math.max(30, Math.min(220, 6000 / timelineDates.length));
      playTimer = setInterval(() => {
        const nextIdx = Number(slider.value) + 1;
        if (nextIdx > lastIdx) {
          clearInterval(playTimer);
          playTimer = null;
          playBtn.textContent = "▶ Afspelen";
          return;
        }
        slider.value = String(nextIdx);
        applyTimelineIndex(nextIdx);
      }, stepMs);
    });
  } else if (timelineSection) {
    timelineSection.style.display = "none";
  }

  if (geojson.generated_at) {
    document.getElementById("last-updated").textContent =
      "laatste update: " + new Date(geojson.generated_at).toLocaleString("nl-NL");
  }
}

main();
