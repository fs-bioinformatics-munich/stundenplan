# Stundenplan app

Static weekly scheduler for the WS 26/27 database. Reads `public/data/schedule.json`, which the scraper side generates.

```
# from the repository root
python3 scrape.py            # crawl TUMonline into stundenplan.db (resumable, cached in raw/)
python3 build_catalog.py     # PDF + website + handbook paths -> data/modulkatalog.json, data/catalog_report.md (needs pdftotext)
python3 build_cit_modules.py # PDF module descriptions of the CIT catalog -> data/cit_modules.{json,csv} (hand corrections in data/cit_modules_manual.json)
python3 export_data.py       # stundenplan.db + catalogs + CIT modules -> app/public/data/schedule.json

# in app/
npm install
npm run dev                  # development server
npm test                     # unit tests (layout, selection, URL hash)
npm run build && npm run e2e # build, then the end-to-end test (needs Chrome; CHROME_PATH to override)
BASE_URL=/repo/ npm run build   # build for https://<user>.github.io/repo/
```

Catalog and credit precedence is PDF > handbook > website (see `plan_web_app.md`, section "Update: catalogs, credits and box content").

Everything runs in the browser; nothing is sent anywhere. The selection is stored in `localStorage` and in the URL hash, so a schedule link can be shared.

Links to the source documents and the contact box (footer) are set in `src/config.ts`; fill in `CONTACT` there.
