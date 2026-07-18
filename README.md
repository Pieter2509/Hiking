# Wandelkaart

Een persoonlijke website die al je gewandelde routes op een kaart zet, met
statistieken (totale afstand, hoogtemeters, aantal landen, langste tocht, ...).

Alle data komt uit **Strava**, opgehaald via een GitHub Action die elke nacht
draait. Komoot-tochten hoeven niet apart aangeleverd te worden: die worden
automatisch naar Strava geüpload en komen dus vanzelf mee via de API.

## 1. Repo klaarzetten

1. Maak een nieuwe **publieke** GitHub-repository (bijv. `wandelkaart`).
2. Zet alle bestanden uit dit project in de root van die repo en push ze.

## 2. Strava-koppeling instellen

1. Ga naar [strava.com/settings/api](https://www.strava.com/settings/api) en maak
   een API-applicatie aan. Noteer je **Client ID** en **Client Secret**.
2. Open in je browser (vervang `CLIENT_ID`):

   ```
   https://www.strava.com/oauth/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all
   ```

3. Log in, geef toestemming. Je wordt doorgestuurd naar een `localhost`-URL die
   niet laadt — dat is prima. Kopieer de waarde van `code=...` uit de adresbalk.
4. Wissel deze code in voor een refresh token (vul `CLIENT_ID`, `CLIENT_SECRET`
   en `CODE` in):

   ```bash
   curl -X POST https://www.strava.com/oauth/token \
     -d client_id=CLIENT_ID \
     -d client_secret=CLIENT_SECRET \
     -d code=CODE \
     -d grant_type=authorization_code
   ```

   Het antwoord bevat een `refresh_token` — die heb je nodig, niet het (tijdelijke)
   `access_token`.

5. Ga in je GitHub-repo naar **Settings → Secrets and variables → Actions** en
   voeg drie secrets toe:
   - `STRAVA_CLIENT_ID`
   - `STRAVA_CLIENT_SECRET`
   - `STRAVA_REFRESH_TOKEN`

## 3. GitHub Pages aanzetten

Ga naar **Settings → Pages** en zet **Source** op **GitHub Actions**.

## 4. Eerste run

Ga naar het tabblad **Actions**, kies de workflow "Update wandeldata en
publiceer site" en klik **Run workflow**. Daarna draait hij vanzelf elke nacht
(en bij elke push naar `main`).

De site verschijnt op `https://<jouw-gebruikersnaam>.github.io/<repo-naam>/`.

## Alleen wandelingen

Het script filtert Strava-activiteiten op `sport_type` **Hike** en **Walk**.
Fietstochten, hardlopen, etc. worden genegeerd. Pas de set `WALK_SPORT_TYPES`
in `scripts/update_data.py` aan als je dat ooit wilt verruimen.

## Landen bepalen

Voor elke wandeling wordt het startpunt eenmalig omgezet naar een land via de
gratis OpenStreetMap Nominatim-dienst. Resultaten worden gecachet in
`data/.cache/geocode.json`, zodat dezelfde locatie niet steeds opnieuw wordt
opgevraagd.

## Lokaal testen

```bash
pip install -r scripts/requirements.txt
export STRAVA_CLIENT_ID=...
export STRAVA_CLIENT_SECRET=...
export STRAVA_REFRESH_TOKEN=...
python scripts/update_data.py
python -m http.server 8000   # open daarna localhost:8000
```
