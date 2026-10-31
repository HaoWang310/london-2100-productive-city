# London 2100 · Productive City

Architectural research project: a water-informed, productive urban landscape for Greater London in 2100.

## Interactive model

The site is published from the repository's `index.html` through GitHub Pages:

https://haowang310.github.io/london-2100-productive-city/

Current presentation: **FORM / ASSEMBLY — GitHub Pages public default Rhino source**. All visitors load the same repository model file `2(2).3dm` when present and valid. The original embedded 24-parcel / 58-Form model is retained as a fallback only.

> The crossings and road markings are concept-stage design geometry, not an approved traffic-engineering scheme. The Rhino-derived model remains unchanged.

## Latest Rhino source geometry (October 2026)

The app now fetches **`2(2).3dm` at the repository root automatically on every browser**, without a "导入最新 3DM" or "恢复内置版本" dialog. A browser-local IndexedDB model can no longer override the public site geometry.

**Required asset:** the 9,345,441-byte binary `2(2).3dm` must be uploaded separately to the `main` branch at the repository root. The source file is not added by the JavaScript commit. Until this exact asset exists and is parseable, visitors see the original embedded baseline; no fabricated replacement is generated. Use the GitHub website: **Add file → Upload files → `2(2).3dm` → Commit changes**. The GitHub Pages link stays unchanged.

The public importer maps Rhino layer names containing 道路 / Roads, 场地 / Site, 结构 / Structure, and rebuilds source-aware geometry, parcels, structural groups and counts. The Rhino 8 decoding dependency uses the McNeel JS/WASM CDN. Geometry with missing render meshes is rejected instead of replaced with invented meshes.

**QA limitation:** zebra crossings, traffic markings, medians, water, landscaping and vehicles designed against an earlier site are not automatically transferable to a new geometry. They require source-aligned recalibration and independent browser visual review. Source geometry is not altered by the loader.

## Publish updates

Replace `index.html` on `main`. The included GitHub Pages workflow redeploys the website after each push. Once Pages is enabled in **Settings → Pages → Build and deployment → GitHub Actions**, visitors use the same URL and refresh after the deployment has completed.

## Project scope

- Computational urbanism and ecological infrastructure
- Road and parcel networks
- Structure assembly and parametric Forms
- Adaptive land use, farming, parkland and water
- Interactive HTML and Rhino-derived visualisation
