# Canopy

![Tests](https://github.com/apande20/canopy/actions/workflows/tests.yml/badge.svg)

Canopy v0.4: parcel screening, a deal calculator and an agricultural lease screen.

This package extends the uploaded Canopy prototype with a transparent, browser-local land deal calculator. It is a prototype, not a production underwriting platform.

## Run locally

1. Extract the ZIP.
2. From this folder, run `python3 -m http.server 8000`.
3. Open `http://localhost:8000` in your browser.

The site uses external public services and libraries, including Leaflet, OpenStreetMap/Nominatim, FEMA, Open-Meteo, Open-Elevation, USGS, NLCD/MRLC and USDA Soil Data Access. Network access, browser CORS behavior, upstream rate limits, API availability and service terms can affect the parcel scan. The calculator works locally and does not send its financial inputs to a server.

## Included

- `index.html`: original Canopy interface and live parcel-scanning code, plus the new underwriting calculator.
- `engine.js`: original v0.1 engine source from the project files; the current page has a more extensive integrated data engine inside `index.html`.

## New underwriting calculator

- User-entered purchase price, closing costs, due diligence, improvements, annual gross income, operating costs, holding period, appreciation, LTV, interest rate, selling costs and target ROI.
- Base, downside and upside scenarios. Default stresses: downside revenue −20%, costs +15%, appreciation −2 percentage points; upside revenue +10%, costs −5%, appreciation +2 percentage points. These are illustrative defaults, not empirical forecasts.
- Initial cash required, annual cash flow, total profit, total ROI, exit value, and an estimated maximum offer price for the target ROI.
- CSV export and print/save brief.

## Model limitations

- Financing is simplified as interest-only; principal is repaid at exit. Taxes, loan fees, amortization, working capital, capex after acquisition, vacancies, income growth and other omitted costs are not modeled unless included in the inputs. ROI is total ROI on initial cash, not IRR.
- Maximum offer is a mathematical output of the entered assumptions, not a valuation.
- Scoring weights are unvalidated judgment-based heuristics and need testing against known parcels and outcomes.
- FEMA no-feature responses are now treated as unknown/unmapped rather than assumed to be Zone X; this is still not a substitute for official flood-zone verification.
- The page does not currently implement real parcel boundaries, zoning verification, verified comparable sales, water rights, groundwater availability or a production backend/database/authentication.
- The existing marketing page includes illustrative visuals/metrics and should be audited before public launch.

## Suggested next development steps

1. Run tests on 10–20 parcels with known conditions and inspect every source failure path.
2. Add unit tests for financial calculations and scoring.
3. Persist parcel analyses and assumption versions in a backend (e.g. PostgreSQL/PostGIS) only after user validation.
4. Add source dates, coverage, data-quality states and a more comprehensive audit trail.
5. Integrate zoning, verified sales and other paid/public datasets only after licensing, coverage and customer demand are assessed.

## Agricultural lease screen (v0.3)

A lease-screening workspace at `#lease` (also linked from the parcel-scan panel and the nav). Workflow: parcel scan, lease inputs, generated memo, evidence and tasks, print or export.

### Files

- `lease-core.js`: pure logic with no DOM: form schema, validation, rent math, screening rules, task generation, evidence register, memo model, Markdown export, storage parsing. Loads in the browser (`window.LeaseCore`) and in Node.
- `lease-ui.js`: the browser interface. Renders all user text with `textContent` or form values; no user string goes into `innerHTML`.
- `lease.css`: screen and print styles, using the page's existing color and type variables.
- `index.html`: adds the section markup, nav/footer links, an entry button under the scan controls, and a small hook at the end of the scan that publishes a snapshot (`window.CanopyLastScan` and a `canopy:scan` event). The existing scoring code is unchanged.
- `tests/lease-core.test.js`: unit tests (Node 18+, no dependencies).
- `tests/browser_check.py`: optional end-to-end check (needs Python Playwright). It fakes the public APIs, so it checks wiring, not live data.

### Run the tests

```
node --test tests/lease-core.test.js
python3 tests/browser_check.py   # optional; pip install playwright && playwright install chromium
```

### Screening rules (also printed in every memo)

- R1 Hold if irrigation is required and the water-supply documentation task is not resolved with a recorded basis and reviewer.
- R2 Hold if the irrigation requirement is unknown.
- R3 Hold if rent amount, charged acreage (per-acre basis) or term is missing.
- R4 Hold if a minimum usable acreage is stated but usable acreage is unknown, or below the minimum without user confirmation.
- R5 Hold if any task marked critical is unresolved or its resolution is outdated.
- R6 Hold if no parcel scan is attached.
- R7 Does not meet stated requirements only on a user-confirmed conflict (confirmed usable acreage below the minimum, or a conflict recorded in the task section).
- R8 Advance to further diligence when nothing above applies. Not approval to sign and not a certification.

R2 and R6 are configured critical questions added for this prototype; change them in `lease-core.js` if you disagree.

### Limitations

- Storage is this browser's `localStorage` only: not shared, not backed up, not secure document storage.
- No lease parsing, legal review, market rent, yield, profit or land-value estimates.
- Scan metadata is limited to what the scan provides. Dataset dates are only shown where the code knows them (NLCD 2021); other sources show "Not provided by scan".
- The scoring model has no version number, so memos record it as not versioned.
- Free-text requirements are displayed but not checked automatically.

## GitHub

### Repository files

- `.gitignore`: keeps OS files, caches, test output and `.env` secrets out of the repo.
- `.nojekyll`: tells GitHub Pages to serve the files as-is.
- `package.json`: `npm test` runs the unit tests; `npm start` serves the site locally. No dependencies.
- `.github/workflows/tests.yml`: GitHub Actions runs the unit tests and the browser check on every push and pull request. Screenshots and the print PDF from the browser check are kept as a downloadable artifact on each run.

### Publish with GitHub Pages

1. Push this folder to the repository's `main` branch.
2. In the repository, open Settings, then Pages.
3. Under Build and deployment, choose Deploy from a branch, then `main` and `/ (root)`.
4. The site appears at `https://<username>.github.io/<repository>/` within a few minutes.

The page calls public APIs directly from the browser, so it needs no server or API keys.

### Licence

No licence file is included, so the code is "all rights reserved" by default. Add one only if you decide to let others reuse the code.

## Parcel scan additions (v0.4)

### Existing structures (FEMA USA Structures)

Each scan counts building footprints over 450 sq ft on the drawn parcel (or within 150 m of a single point), split into homes, farm buildings or outbuildings, and other. It also counts buildings within 1 km as a rough stand-in for road and utility access. Footprints are drawn on the map.

- Housing score: new "nearby buildings" factor at 15%. Other weights are now flood 27%, slope 27%, land cover 20%, elevation 11%.
- Farmland score: capped when buildings cover a large share of a drawn parcel (75 at 15% cover, 50 at 30%).
- Memo notes flag homes on land marked Vacant, heavy building cover, and no buildings within 1 km.

### Residential / homesite use

A new "Primary use today" option. Housing leads; Farmland is read as garden or hobby-farm potential. Notes confirm whether FEMA maps homes on the lot.

### County land value and cash rent (USDA NASS)

The memo shows the county's average farmland value per acre (Census of Agriculture), a county benchmark for the parcel's acreage, and county cash rents. The benchmark is a county average, not an appraisal. The lease screen shows county cash rent as context only, never as a market-rent estimate.

The data lives in `land_values.js`, built once from USDA Quick Stats:

```
NASS_KEY=your_key node scripts/fetch_land_values.js
```

Get a free key at quickstats.nass.usda.gov/api. The script reads the key from the command line so it is never saved in the repo. Commit the generated `land_values.js`. Until it exists, scans still work and the land value source shows as unavailable. The county is found with the FCC's free Census Area API.
