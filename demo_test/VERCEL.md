# Vercel Deployment Notes

This repository is not structured with the app at the repository root. The app you want Vercel to deploy lives in:

- `demo_test/webapp`

## Recommended dashboard setup

1. Import the GitHub repository into Vercel.
2. Set `Root Directory` to `demo_test/webapp`.
3. Set `Framework Preset` to `Other`.
4. Leave `Build Command` blank.
5. Leave `Output Directory` at the default so Vercel serves the project root directly.

## Why this works

- `demo_test/webapp` already contains static `HTML`, `CSS`, `JS`, assets, and the generated JSON data bundle.
- `demo_test/webapp/vercel.json` is in the correct project root for that deployment.
- No Node build or Python build step is required for hosting.

## Updating the data

If `demo_test/demos.csv` changes:

```bash
cd demo_test
python3 scripts/build_demo_dataset.py
```

Then commit the updated files:

- `demo_test/webapp/data/demos_compact.json`
- `demo_test/webapp/data/meta.json`

## Optional CLI deployment

If you use the Vercel CLI locally, deploy from the app root:

```bash
vercel --cwd demo_test/webapp
```
