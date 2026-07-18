const DATA_URL = "data/activities.geojson";

const fmt = new Intl.NumberFormat("nl-NL");
const fmt1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

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
  return {
    color: "#FFC736",
    weight: 3.5,
    opacity: 0.95,
    className: "walked-route",
  };
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

function renderList(features, map, layerByFeature) {
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

    const dateStr = f.properties.date
      ? new Date(f.properties.date).toLocaleDateString("nl-NL", { year: "numeric", month: "short", day: "2-digit" })
      : "—";

    li.innerHTML = `
      <span class="walk-date">${dateStr}</span>
      <span class="walk-name">${f.properties.name || "Naamloze wandeling"}${f.properties.country ? ` · ${f.properties.country}` : ""}</span>
      <span class="walk-metrics">${fmt1.format(km(f.properties.distance_m || 0))} km &nbsp;·&nbsp; +${fmt.format(Math.round(f.properties.elevation_gain_m || 0))} m</span>
    `;

    const focusRoute = () => {
      const layer = layerByFeature.get(f);
      if (layer) {
        map.fitBounds(layer.getBounds(), { maxZoom: 13 });
        const el = layer.getElement();
        layer.setStyle({ color: "#3ddc59", weight: 6 });
        if (el) el.classList.add("walked-route-active");
        setTimeout(() => {
          layer.setStyle({ color: "#FFC736", weight: 3.5 });
          if (el) el.classList.remove("walked-route-active");
        }, 1400);
      }
    };

    li.addEventListener("click", focusRoute);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") focusRoute(); });

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
    },
  }).addTo(map);

  if (features.length > 0) {
    map.fitBounds(geoLayer.getBounds(), { padding: [30, 30] });
  }

  renderStats(features);
  renderList(features, map, layerByFeature);

  if (geojson.generated_at) {
    document.getElementById("last-updated").textContent =
      "laatste update: " + new Date(geojson.generated_at).toLocaleString("nl-NL");
  }
}

main();
