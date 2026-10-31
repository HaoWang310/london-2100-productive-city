# London 2100 · Productive City

Architectural research project: a water-informed, productive urban landscape for Greater London in 2100.

## Interactive model

The site is published from the repository's `index.html` through GitHub Pages:

https://haowang310.github.io/london-2100-productive-city/

Current presentation: **FORM / ASSEMBLY — source-aware Rhino 8 import**. The embedded baseline retains the original 24-parcel / 58-Form model; a new browser import facility supports roads, site and structures from a newer Rhino 3DM.

> The crossings and road markings are concept-stage design geometry, not an approved traffic-engineering scheme. The Rhino-derived model remains unchanged.

## Latest Rhino source geometry (October 2026)

The updated App includes **导入最新 3DM** in the header. Choose the Rhino file; source objects are classified by layer name (道路Roads / 场地(Site) / 结构), using actual mesh data, and site/road geometry, estimated unit dimensions, Form groups and counts are rebuilt. Objects without readable render meshes are never silently invented or substituted. Invalid site/road/structure imports are rejected.

**Browser-local only:** This repository does NOT contain the uploaded 9 MB Rhino source binary. Browser imports are saved in IndexedDB and remain available across refreshes on that browser, but are not distributed to other GitHub Pages visitors. The public default continues to show the original embedded model until the verified new geometry is separately published into GitHub. **恢复内置版本** clears the local override.

**Geometry QA:** The legacy zebra crossings, green medians, road vehicle positions, landscape and water from the previous site are disabled on a new source until geometry-specific recalibration. Imported site objects are represented by estimated mesh-component boundaries, not verified road-minus-site Boolean parcel cuts. Reports flag these geometric and topological limitations explicitly; do not use the estimates for construction or traffic design.

Conversion requires the McNeel Rhino3dm JavaScript/WASM CDN. If the importer rejects uncached Brep/SubD objects, save a source with readable Rhino render meshes before retrying. See tests/verify-rhino-model-import.cjs and .github/workflows/verify-rhino-model-import.yml.

## Publish updates

Replace `index.html` on `main`. The included GitHub Pages workflow redeploys the website after each push. Once Pages is enabled in **Settings → Pages → Build and deployment → GitHub Actions**, visitors use the same URL and refresh after the deployment has completed.

## Project scope

- Computational urbanism and ecological infrastructure
- Road and parcel networks
- Structure assembly and parametric Forms
- Adaptive land use, farming, parkland and water
- Interactive HTML and Rhino-derived visualisation
