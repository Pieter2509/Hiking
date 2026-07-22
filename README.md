# Wandelkaart

Een persoonlijke website die al je gewandelde routes op een kaart zet, met
statistieken (totale afstand, hoogtemeters, aantal landen, langste tocht, ...).

Alle data komt uit **Strava**, opgehaald via een GitHub Action die elke nacht
draait.

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

## Ververs-knop met 1 klik

De site heeft een knop **"🔄 Ververs data nu"** die de workflow direct kan
starten, zonder dat je naar GitHub hoeft. Dat gaat via een gratis Cloudflare
Worker: een klein "tussenlaagje" dat jouw GitHub-token veilig achter de hand
houdt (de website zelf bevat nooit een GitHub-token — alleen een simpel
trigger-woordje, waarmee iemand hooguit deze ene workflow nog eens kan
starten, verder niets).

### 1. GitHub-token aanmaken (alleen voor deze ene workflow)

1. Ga naar [github.com/settings/tokens](https://github.com/settings/tokens) →
   **Fine-grained tokens** → **Generate new token**.
2. Bij **Repository access**: kies **Only select repositories** en selecteer
   je wandelkaart-repo.
3. Bij **Permissions → Actions**: zet op **Read and write**. Verder niets aanvinken.
4. Genereer en kopieer het token (je ziet 'm maar één keer).

### 2. Cloudflare Worker aanmaken

1. Maak gratis een account op [cloudflare.com](https://dash.cloudflare.com/sign-up)
   (geen creditcard nodig voor de gratis Workers-laag).
2. Ga naar **Workers & Pages → Create → Create Worker**. Geef 'm een naam,
   bijvoorbeeld `wandelkaart-refresh`, en klik **Deploy**.
3. Klik daarna op **Edit code**, verwijder de voorbeeldcode, en plak de
   inhoud van `cloudflare-worker/worker.js` uit dit project erin.
4. Pas bovenin dat bestand `GITHUB_OWNER`, `GITHUB_REPO` en `ALLOWED_ORIGIN`
   aan naar jouw situatie (`ALLOWED_ORIGIN` is je GitHub Pages-URL, dus iets
   als `https://pieter2509.github.io`).
5. Klik **Deploy** om de wijzigingen op te slaan.
6. Ga naar **Settings → Variables and Secrets** van deze Worker en voeg twee
   **secrets** toe (niet gewone variabelen — kies expliciet "Secret"):
   - `GH_TOKEN` — het token uit stap 1 (let op: niet `GITHUB_TOKEN` gebruiken
     — namen die met "GITHUB_" beginnen zijn gereserveerd)
   - `TRIGGER_SECRET` — een zelfverzonnen wachtwoord, bijv. een lange
     willekeurige reeks tekens

### 3. De website koppelen aan de Worker

1. Kopieer de Worker-URL (te zien bovenaan de Worker-pagina, iets als
   `https://wandelkaart-refresh.jouw-account.workers.dev`).
2. Open `assets/app.js` en vul bovenin `REFRESH_CONFIG` in:
   ```js
   const REFRESH_CONFIG = {
     workerUrl: "https://wandelkaart-refresh.jouw-account.workers.dev",
     triggerSecret: "hetzelfde-wachtwoord-als-bij-TRIGGER_SECRET",
   };
   ```
3. Commit en push. Klik daarna op de site op **"Ververs data nu"** — dit
   start de workflow direct; ververs de pagina na ongeveer een minuut voor de
   nieuwe data.

Werkt de knop een keer niet (bijv. Worker tijdelijk onbereikbaar), dan staat
er een link onder de knop die je rechtstreeks naar de "Run workflow"-pagina
op GitHub brengt, als terugval-optie.

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
