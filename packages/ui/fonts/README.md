# Bundled fonts

These files are vendored deliberately. `docs/brand.md` requires both families to be
**bundled inside the app, never CDN-loaded**, because the app must work fully offline
(PRD NFR-S1). The website self-hosts the same files.

| File | Family | Weight | Used for |
|---|---|---|---|
| `lora-latin-500.woff2` | Lora | 500 | Headings, document titles |
| `lora-latin-600.woff2` | Lora | 600 | Headings, document titles |
| `manrope-latin-400.woff2` | Manrope | 400 | Body / UI |
| `manrope-latin-500.woff2` | Manrope | 500 | Body / UI |
| `manrope-latin-600.woff2` | Manrope | 600 | Body / UI |
| `manrope-latin-700.woff2` | Manrope | 700 | Body / UI |

Latin subset only — the UI is English (PRD §7). Total ~100 KB.

Both families are licensed under the SIL Open Font License 1.1; the full licence text
for each is alongside the binaries (`OFL-Lora.txt`, `OFL-Manrope.txt`) and must stay
with them. Upstream: <https://github.com/google/fonts>.

Only the weights listed in `docs/brand.md` are vendored. If a new weight is genuinely
needed, update `docs/brand.md` first, then add the file and a matching `@font-face`
rule in `../src/styles/fonts.css`.
