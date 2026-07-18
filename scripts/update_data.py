#!/usr/bin/env python3
"""
Haalt wandelingen op uit Strava en schrijft ze naar data/activities.geojson
voor de website.

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
    key = f"{round(lat, 2)},{round(lon, 2)}"
    if key in cache:
        return cache[key]

    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 3},
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        country = resp.json().get("address", {}).get("country")
    except Exception as exc:  # netwerkfouten mogen het script niet laten crashen
        print(f"  waarschuwing: reverse geocoding mislukt voor {lat},{lon}: {exc}", file=sys.stderr)
        country = None

    cache[key] = country
    time.sleep(1)  # respecteer Nominatim's gebruiksvoorwaarden (max 1 req/sec)
    return country


def strava_activity_to_feature(activity, geocode_cache):
    poly = (activity.get("map") or {}).get("summary_polyline")
    if not poly:
        return None

    coords = polyline_lib.decode(poly)  # lijst van (lat, lon)
    if not coords:
        return None

    geojson_coords = [[lon, lat] for lat, lon in coords]
    start_lat, start_lon = coords[0]
    country = reverse_geocode_country(start_lat, start_lon, geocode_cache)

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
            "country": country,
            "source": "strava",
        },
    }


def process_strava(geocode_cache):
    access_token = get_access_token()
    raw_activities = fetch_all_activities(access_token)
    print(f"Strava: {len(raw_activities)} activiteiten opgehaald in totaal.")

    walks = [a for a in raw_activities if a.get("sport_type") in WALK_SPORT_TYPES]
    print(f"Strava: {len(walks)} daarvan zijn wandelingen.")

    features = []
    for activity in walks:
        feature = strava_activity_to_feature(activity, geocode_cache)
        if feature:
            features.append(feature)
    return features


def main():
    geocode_cache = load_json(GEOCODE_CACHE_FILE, {})
    strava_cache = load_json(STRAVA_CACHE_FILE, {"features": []})

    try:
        strava_features = process_strava(geocode_cache)
        strava_cache = {"features": strava_features}
    except KeyError as exc:
        print(f"Let op: Strava secret ontbreekt ({exc}), gebruik cache van vorige run.", file=sys.stderr)
        strava_features = strava_cache.get("features", [])
    except Exception as exc:
        print(f"Waarschuwing: Strava-ophalen mislukt ({exc}), gebruik cache van vorige run.", file=sys.stderr)
        strava_features = strava_cache.get("features", [])

    all_features = strava_features
    all_features.sort(key=lambda f: f["properties"].get("date") or "", reverse=True)

    feature_collection = {
        "type": "FeatureCollection",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "features": all_features,
    }

    save_json(DATA_FILE, feature_collection)
    save_json(STRAVA_CACHE_FILE, strava_cache)
    save_json(GEOCODE_CACHE_FILE, geocode_cache)

    print(f"Klaar: {len(all_features)} wandelingen weggeschreven naar {DATA_FILE.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
