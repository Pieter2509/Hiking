const DATA_URL = "data/activities.geojson";

const fmt = new Intl.NumberFormat("nl-NL");
const fmt1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const ICON_ROUTE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19c3-1 4-4 4-7s2-6 5-6 4 3 4 6 2 6 5 6"/><circle cx="4" cy="19" r="1.4" fill="currentColor" stroke="none"/><circle cx="20" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>';

const ICON_ELEVATION =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19l5.5-9 3.5 5 3-4 6 8H3z"/></svg>';

const NORMAL_STYLE = { color: "#FFC736", weight: 3.5 };
const ACTIVE_STYLE = { color: "#3ddc59", weight: 6 };

function km(meters) { return meters / 1000; }

function initMap() {
  const map = L.map("map", { scrollWheelZoom: true, worldCopyJump: true }).setView([20, 10], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
  }).addTo(map);
  return map;
}

// Alle bewandelde paden krijgen dezelfde "opgelicht asfalt"-stijl.
function styleForFeature() {
  return { ...NORMAL_STYLE, opacity: 0.95, className: "walked-route" };
}

function renderStats(features) {
  const totalDistanceM = features.reduce((s, f) => s + (f.properties.distance_m || 0), 0);
  const totalElevation = features.reduce((s, f) => s + (f.properties.elevation_gain_m || 0), 0);
  const countries = new Set(features.map((f) => f.properties.country).filter(Boolean));
  const count = features.length;

  const currentYear = new Date().getFullYear();
  const thisYearDistanceM = features
    .filter((f) => f.properties.date && new Date(f.properties.date).getFullYear() === currentYear)
    .reduce((s, f) => s + (f.properties.distance_m || 0), 0);

  let longest = null;
  for (const f of features) {
    if (!longest || (f.properties.distance_m || 0) > (longest.properties.distance_m || 0)) longest = f;
  }

  document.getElementById("stat-total-distance").textContent = fmt.format(Math.round(km(totalDistanceM)));
  document.getElementById("stat-total-walks").textContent = fmt.format(count);
  document.getElementById("stat-total-countries").textContent = fmt.format(countries.size);

  document.getElementById("card-distance").textContent = fmt1.format(km(totalDistanceM));
  document.getElementById("card-elevation").textContent = fmt.format(Math.round(totalElevation));
  document.getElementById("card-count").textContent = fmt.format(count);

  if (longest) {
    document.getElementById("card-longest").textContent = fmt1.format(km(longest.properties.distance_m)) + " km";
    document.getElementById("card-longest-name").textContent = longest.properties.name || "—";
  }

  document.getElementById("card-countries").textContent = fmt.format(countries.size);
  document.getElementById("card-countries-list").textContent = [...countries].slice(0, 4).join(", ") || "—";

  document.getElementById("card-year").textContent = fmt1.format(km(thisYearDistanceM));
  document.getElementById("card-year-label").textContent = currentYear;
}

function renderList(features, listItemByFeature, onSelect) {
  const list = document.getElementById("walk-list");
  list.innerHTML = "";

  const sorted = [...features].sort((a, b) => {
    const da = a.properties.date ? new Date(a.properties.date) : 0;
    const db = b.properties.date ? new Date(b.properties.date) : 0;
    return db - da;
  });

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
        <span class="walk-meta">${f.properties.country || "onbekend land"}</span>
      </div>
      <div class="walk-metrics">
        <span class="metric">${ICON_ROUTE}${fmt1.format(km(f.properties.distance_m || 0))} km</span>
        <span class="metric">${ICON_ELEVATION}+${fmt.format(Math.round(f.properties.elevation_gain_m || 0))} m</span>
      </div>
    `;

    listItemByFeature.set(f, li);

    const activate = () => onSelect(f, { fit: true });
    li.addEventListener("click", activate);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });

    list.appendChild(li);
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

  function applyLayerStyle(layer, active) {
    layer.setStyle(active ? ACTIVE_STYLE : NORMAL_STYLE);
    const el = layer.getElement();
    if (el) el.classList.toggle("walked-route-active", active);
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
      if (prevLayer) applyLayerStyle(prevLayer, false);
      const prevItem = listItemByFeature.get(activeFeature);
      if (prevItem) prevItem.classList.remove("walk-item-active");
    }

    activeFeature = feature;

    if (feature) {
      const layer = layerByFeature.get(feature);
      if (layer) {
        applyLayerStyle(layer, true);
        if (fit) map.fitBounds(layer.getBounds(), { maxZoom: 13 });
      }
      const item = listItemByFeature.get(feature);
      if (item) item.classList.add("walk-item-active");
    }
  }

  const geoLayer = L.geoJSON(geojson, {
    style: styleForFeature,
    onEachFeature: (feature, layer) => {
      layerByFeature.set(feature, layer);
      const p = feature.properties;
      layer.bindPopup(
        `<strong>${p.name || "Wandeling"}</strong><br>` +
        `${p.date ? new Date(p.date).toLocaleDateString("nl-NL") : ""}<br>` +
        `${fmt1.format(km(p.distance_m || 0))} km · +${fmt.format(Math.round(p.elevation_gain_m || 0))} m`
      );
      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e); // voorkomt dat de klik ook de kaart-klik (= deselecteren) triggert
        selectFeature(feature, { fit: false });
      });
    },
  }).addTo(map);

  // Klikken op de lege kaart heft de selectie op.
  map.on("click", () => selectFeature(null));

  if (features.length > 0) {
    map.fitBounds(geoLayer.getBounds(), { padding: [30, 30] });
  }

  renderStats(features);
  renderList(features, listItemByFeature, selectFeature);

  if (geojson.generated_at) {
    document.getElementById("last-updated").textContent =
      "laatste update: " + new Date(geojson.generated_at).toLocaleString("nl-NL");
  }
}

main();
