# Back on track? Australia's uneven rail recovery

An original single-scroll FIT3179 Topic 19 visual story. Twelve authored Vega/Vega-Lite figures include three different map idioms and eight proposed advanced families. Chart counting remains subject to tutor assessment.

## View locally
From the repository root: `python3 -m http.server 8000 --directory site`, then open http://localhost:8000/.

All browser assets are local; there are no live-data API calls, analytics or external font dependencies. Use an HTTP server, not file://. Paths support the [GitHub Pages project URL](https://jang0050.github.io/australian-rail-travel/). The published page is a progress version.

## Evidence and limitations
- Complete DTP station and monthly CSVs; no preview/sample records used as a network dataset.
- National scale: complete published Trainline 13 tables 15 and 23, checked in official PDF.
- National recovery: separately labelled Yearbook 2025 city estimates, tables 2.5a–e, 2018–19 to 2024–25. No incompatible series is spliced.
- BITRE workbook acquisition failed; Trainline longitudinal and cross-release reconciliation remain pending. Do not claim that audit is complete.
- ABS original LGA 2025 polygons assign stations; simplified geometry is used only for display. Grids use EPSG:3577 equal-area squares.
- The layout is provisional. No actual hand-drawn sketch or tutor approval has been provided.

Sources, scope, units, transformations and licences appear on the page. `data/provenance.json` records local derivation inputs/hashes; `specs/chart_registry.json` links readable authored specifications. Expand each data table for keyboard-accessible numeric evidence.

Built 16 September 2026. Student author, student ID and studio session remain pending. OpenAI Codex assisted with data processing, design, code, writing and checks. The student must review and acknowledge this assistance before submission.

Source Serif 4 and Source Sans 3: SIL Open Font License, notices in `fonts/`. Vega, Vega-Lite and Vega-Embed: notices and resolved versions in `vendor/`. BITRE and DTP data are attributed under their stated Creative Commons terms. This folder contains no course PDFs, original assignment templates or raw downloads.
