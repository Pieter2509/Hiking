#!/usr/bin/env python3
"""
Haalt wandelingen op uit Strava en schrijft ze naar data/activities.geojson
voor de website.

Voor elke NIEUWE wandeling wordt ook een hoogteprofiel opgehaald (voor het
lijngrafiekje in de kaart-popup) en het land bepaald via reverse geocoding.
Beide worden per activiteit gecachet in data/.cache/, zodat een dagelijkse
run alleen extra Strava-aanroepen doet voor wandelingen die nog niet eerder
zijn verwerkt — bestaande wandelingen worden direct uit de cache herbruikt.

Benodigde environment variables (als GitHub Secrets):
  STRAVA_CLIENT_ID
  STRAVA_CLIENT_SECRET
  STRAVA_REFRESH_TOKEN

Zie README.md voor hoe je deze verkrijgt.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
import polyline as polyline_lib

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "activities.geojson"
CACHE_DIR = ROOT / "data" / ".cache"
STRAVA_CACHE_FILE = CACHE_DIR / "strava_activities.json"
GEOCODE_CACHE_FILE = CACHE_DIR / "geocode.json"

WALK_SPORT_TYPES = {"Hike", "Walk"}
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "wandelkaart-personal-site (contact via github repo)"

# Hoeveel PUNTEN het hoogteprofiel per wandeling maximaal krijgt (voor een
# klein, snel te laden sparkline-grafiekje in de popup).
ELEVATION_PROFILE_POINTS = 40

# Veiligheidsgrens: hoeveel NIEUWE hoogteprofielen er maximaal per run worden
# opgehaald. Voorkomt dat een grote inhaalslag (bijv. bij de allereerste run
# met honderden bestaande wandelingen) de Strava-ratelimit raakt. De rest
# wordt gewoon bij de volgende dagelijkse run opgepakt.
MAX_NEW_ELEVATION_FETCHES_PER_RUN = 80


def load_json(path, default):
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_access_token():
    client_id = os.environ["STRAVA_CLIENT_ID"]
    client_secret = os.environ["STRAVA_CLIENT_SECRET"]
    refresh_token = os.environ["STRAVA_REFRESH_TOKEN"]

    resp = requests.post(
        "https://www.strava.com/oauth/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def fetch_all_activities(access_token):
    activities = []
    page = 1
    headers = {"Authorization": f"Bearer {access_token}"}
    while True:
        resp = requests.get(
            "https://www.strava.com/api/v3/athlete/activities",
            headers=headers,
            params={"per_page": 200, "page": page},
            timeout=30,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        activities.extend(batch)
        page += 1
    return activities


def reverse_geocode_country(lat, lon, cache):
    """Geeft (naam, ISO-landcode) terug, bijv. ("Nederland", "nl").
    De code wordt gebruikt om betrouwbaar een vlagemoji te tonen op de site,
    ongeacht in welke taal Nominatim de naam teruggeeft."""
    key = f"{round(lat, 2)},{round(lon, 2)}"
    cached = cache.get(key)
    if isinstance(cached, dict) and "code" in cached:
        return cached.get("name"), cached.get("code")
    # oudere cache-versie (alleen een naam-string) telt als "nog niet bekend"
    # zodat de landcode er alsnog eenmalig bij gehaald wordt.

    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 3},
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        address = resp.json().get("address", {})
        name = address.get("country")
        code = address.get("country_code")
    except Exception as exc:  # netwerkfouten mogen het script niet laten crashen
        print(f"  waarschuwing: reverse geocoding mislukt voor {lat},{lon}: {exc}", file=sys.stderr)
        name, code = None, None

    cache[key] = {"name": name, "code": code}
    time.sleep(1)  # respecteer Nominatim's gebruiksvoorwaarden (max 1 req/sec)
    return name, code


def downsample_profile(distances_km, elevations_m, max_points):
    n = len(distances_km)
    if n <= max_points:
        return list(zip(distances_km, elevations_m))
    step = (n - 1) / (max_points - 1)
    result = []
    for i in range(max_points):
        idx = round(i * step)
        result.append((distances_km[idx], elevations_m[idx]))
    return result


def fetch_elevation_profile(access_token, activity_id):
    """Haalt een compact hoogteprofiel op: een lijst van
    [afstand_km, hoogte_m]-punten, gedownsampled voor een klein bestand."""
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        resp = requests.get(
            f"https://www.strava.com/api/v3/activities/{activity_id}/streams",
            headers=headers,
            params={"keys": "distance,altitude", "key_by_type": "true", "resolution": "low"},
            timeout=20,
        )
        if resp.status_code == 404:
            return None  # activiteit zonder streams (bijv. handmatig ingevoerd)
        resp.raise_for_status()
        data = resp.json()
        distances = (data.get("distance") or {}).get("data")
        altitudes = (data.get("altitude") or {}).get("data")
        if not distances or not altitudes or len(distances) != len(altitudes):
            return None
        points = downsample_profile(distances, altitudes, ELEVATION_PROFILE_POINTS)
        return [[round(d / 1000, 3), round(e, 1)] for d, e in points]
    except Exception as exc:
        print(f"  waarschuwing: hoogteprofiel ophalen mislukt voor activiteit {activity_id}: {exc}", file=sys.stderr)
        return None


def strava_activity_to_feature(activity, geocode_cache, access_token, elevation_fetch_budget):
    """Bouwt een GeoJSON-feature voor een activiteit. elevation_fetch_budget is
    een lijst [aantal_nog_over] (mutable, zodat de aanroeper de teller kan
    bijhouden over meerdere activiteiten heen)."""
    poly = (activity.get("map") or {}).get("summary_polyline")
    if not poly:
        return None

    coords = polyline_lib.decode(poly)  # lijst van (lat, lon)
    if not coords:
        return None

    geojson_coords = [[lon, lat] for lat, lon in coords]
    start_lat, start_lon = coords[0]
    country_name, country_code = reverse_geocode_country(start_lat, start_lon, geocode_cache)

    elevation_profile = None
    if elevation_fetch_budget[0] > 0:
        elevation_profile = fetch_elevation_profile(access_token, activity["id"])
        elevation_fetch_budget[0] -= 1

    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": geojson_coords},
        "properties": {
            "id": f"strava-{activity['id']}",
            "name": activity.get("name"),
            "date": activity.get("start_date_local") or activity.get("start_date"),
            "distance_m": activity.get("distance"),
            "elevation_gain_m": activity.get("total_elevation_gain"),
            "moving_time_s": activity.get("moving_time"),
            "country": country_name,
            "country_code": country_code,
            "elevation_profile": elevation_profile,
            "source": "strava",
        },
    }


def process_strava(geocode_cache, features_by_id):
    access_token = get_access_token()
    raw_activities = fetch_all_activities(access_token)
    print(f"Strava: {len(raw_activities)} activiteiten opgehaald in totaal.")

    walks = [a for a in raw_activities if a.get("sport_type") in WALK_SPORT_TYPES]
    print(f"Strava: {len(walks)} daarvan zijn wandelingen.")

    elevation_fetch_budget = [MAX_NEW_ELEVATION_FETCHES_PER_RUN]
    features = []
    new_count = 0

    for activity in walks:
        feature_id = f"strava-{activity['id']}"
        cached_feature = features_by_id.get(feature_id)
        if cached_feature is not None:
            features.append(cached_feature)
            continue

        feature = strava_activity_to_feature(activity, geocode_cache, access_token, elevation_fetch_budget)
        if feature:
            features.append(feature)
            features_by_id[feature_id] = feature
            new_count += 1

    print(f"Strava: {new_count} nieuwe wandeling(en) verwerkt, {len(features) - new_count} uit cache herbruikt.")
    if elevation_fetch_budget[0] <= 0 and new_count > 0:
        print("  let op: limiet voor hoogteprofielen deze run bereikt — rest volgt bij de volgende run.")

    return features


def main():
    geocode_cache = load_json(GEOCODE_CACHE_FILE, {})
    strava_cache = load_json(STRAVA_CACHE_FILE, {"features_by_id": {}})
    features_by_id = strava_cache.get("features_by_id", {})

    try:
        strava_features = process_strava(geocode_cache, features_by_id)
    except KeyError as exc:
        print(f"Let op: Strava secret ontbreekt ({exc}), gebruik cache van vorige run.", file=sys.stderr)
        strava_features = list(features_by_id.values())
    except Exception as exc:
        print(f"Waarschuwing: Strava-ophalen mislukt ({exc}), gebruik cache van vorige run.", file=sys.stderr)
        strava_features = list(features_by_id.values())

    all_features = strava_features
    all_features.sort(key=lambda f: f["properties"].get("date") or "", reverse=True)

    feature_collection = {
        "type": "FeatureCollection",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "features": all_features,
    }

    save_json(DATA_FILE, feature_collection)
    save_json(STRAVA_CACHE_FILE, {"features_by_id": features_by_id})
    save_json(GEOCODE_CACHE_FILE, geocode_cache)

    print(f"Klaar: {len(all_features)} wandelingen weggeschreven naar {DATA_FILE.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
