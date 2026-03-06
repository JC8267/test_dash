# ZIP Demographic Heatmap Explorer

Static webapp for exploring ZIP-level demographic heatmaps from `demos.csv`.

## What it does

- Builds a compact browser-friendly dataset from the raw 1,175-column CSV.
- Shows a ZIP-level heatmap driven by a selectable primary metric.
- Supports grouped geography filters for state, county, MSA, search, and minimum population.
- Lets users stack custom demographic cuts across age, race, income, education, housing, and workforce metrics.
- Highlights the top ZIPs for the currently selected metric.

## Files

- `scripts/build_demo_dataset.py`: converts `demos.csv` into compact JSON files.
- `webapp/index.html`: static app shell.
- `webapp/js/config.js`: curated metric catalog and grouped presets.
- `webapp/js/app.js`: filtering, map, summaries, and results logic.
- `webapp/styles.css`: UI styling.
- `serve_webapp.py`: simple local server.

## Rebuild the data bundle

```bash
python3 scripts/build_demo_dataset.py
```

This writes:

- `webapp/data/demos_compact.json`
- `webapp/data/meta.json`

## Run the app

```bash
python3 serve_webapp.py --port 8000
```

Then open `http://localhost:8000`.

## Deploy on Vercel

This app is already prebuilt as a static site in `demo_test/webapp`, so Vercel does not need a build step.

1. Push this repo to GitHub.
2. In Vercel, import the repository.
3. Set `Root Directory` to `demo_test/webapp`.
4. Use `Framework Preset = Other`.
5. Leave `Build Command` empty.
6. Leave `Output Directory` empty so Vercel serves the project root directly.

Notes:

- `demo_test/webapp/vercel.json` is scoped to the deployed app root and enables clean URLs.
- The deployed site uses the committed JSON bundle in `demo_test/webapp/data/`.
- If `demos.csv` changes, rerun `python3 scripts/build_demo_dataset.py` from `demo_test/`, then commit the updated JSON files.

## Curated metrics in the app

The raw CSV is reduced to a smaller set of derived ZIP-level metrics so the app stays responsive:

- Population and households
- Population density
- Median age
- Median household income
- Median owner-occupied home value
- Race and ethnicity shares
- Age-band shares
- College+ and advanced degree shares
- Owner/renter shares
- High-income and lower-income household shares
- Unemployment rate
- White-collar worker share
- Family poverty share
