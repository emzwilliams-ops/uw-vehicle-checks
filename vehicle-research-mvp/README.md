# Underwriting Intelligence

A Netlify-ready UK vehicle research app for underwriting and claims triage. Enter a registration, pull official and open-web signals together, save case notes, preserve evidence snapshots, and export a report from one place.

## What it does

- accepts a UK vehicle registration and normalises the plate
- uses live DVLA data when `DVLA_API_KEY` is set
- uses live DVSA MOT history when the MOT credentials are set
- uses a web search provider for adverts, auction history, recall mentions, and other public references
- saves each report, case notes, and evidence snapshots in Netlify Blobs
- exports each report as CSV
- provides a print-friendly browser view for saving as PDF
- falls back gracefully when any source is not yet configured
- includes demo data for `AB12CDE` so you can test the report shape immediately

## Project structure

- `public/`: frontend
- `netlify/functions/`: serverless API endpoints and shared logic
- `data/sample_reports.json`: demo vehicle data

## Netlify setup

1. Import the repo into Netlify.
2. Use `npm run build` as the build command.
3. Use `public` as the publish directory.
4. Use `netlify/functions` as the functions directory.
5. Add the environment variables from `.env.example`.

Official docs:

- [Netlify Functions](https://docs.netlify.com/build/functions/get-started/)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Redirects and rewrites](https://docs.netlify.com/routing/redirects/)

## Local development

```bash
cd /Users/emz.williams/Documents/vehicle-research-mvp
npm install
npx netlify dev
```

## API routes

- `GET /api/health`
- `GET /api/reports`
- `GET /api/report?id=<reportId>`
- `POST /api/search`
- `POST /api/notes`
- `POST /api/snapshot`
- `GET /api/snapshot-open?id=<snapshotId>`
- `GET /api/export?id=<reportId>`

## Notes

- Reports are a research aid and not a liability or causation decision engine.
- Recall, MOT, and open-web findings should be treated as follow-up leads and evidence prompts.
