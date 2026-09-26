## 1. Catalog and metadata

- [ ] 1.1 Audit all current gallery consumers and freeze a display parity fixture
- [ ] 1.2 Add catalog/author schema v1 and one Python reader; migrate the bundled catalog and resolver together without a legacy reader or custom-root setting
- [ ] 1.3 Derive connection/tool summaries from packages and preserve published package versions
- [ ] 1.4 Add POST query and GET detail using repository API conventions
- [ ] 1.5 Migrate every in-app consumer, prove parity, and remove the handwritten runtime catalog
- [ ] 1.6 Generate website JSON from the same reader and prove API/build parity

## 2. Create and load

- [ ] 2.1 Inspect attachment/drive authorization and use one file-reference path where supported, otherwise two thin adapters with one archive resolver
- [ ] 2.2 Implement bounded extraction and source DTO updates; audit source.key assumptions
- [ ] 2.3 Expose read-only zip validation through the existing parser; return structured repair issues and content pins
- [ ] 2.4 Extend load with authorized zip inputs and preserve connection setup, first-message and no-duplicate behavior
- [ ] 2.5 Make completed retries independent of source refetch; test interrupted and conflicting requests
- [ ] 2.6 Add recipient-aware export skill: write files, zip, validate, repair/rebuild, and deliver the validated zip
- [ ] 2.7 Add Save as template through normal chat; preserve draft text and prevent duplicate sends
- [ ] 2.8 Run simple, integration and general/team-specific export/load cases with smaller and reference models

## 3. GitHub loading

- [ ] 3.1 Accept public repository + full commit + directory only; reject branches, tags, abbreviated commits and ref fields
- [ ] 3.2 Fetch the selected directory with bounded traversal/downloads and no whole-repository fallback
- [ ] 3.3 Record source provenance and test fork heads, missing paths, private sources, invalid paths and a small package in the real monorepo
- [ ] 3.4 Test replay after remote unavailability and exact-pin recovery after interruption

## 4. Marketplace

- [ ] 4.1 Validate all packages and catalog/author references in CI, with a Git comparison for published-version immutability
- [ ] 4.2 Document and rehearse the manual contribution path; configure the required check only with maintainer authorization
- [ ] 4.3 Receive Mahmoud's marketplace website UI designs and resolve any data-contract conflicts before visual implementation
- [ ] 4.4 Build template index/detail/author pages from generated data; preserve key links and unavailable-version behavior
- [ ] 4.5 Add guided submission after the manual path and exact-head testing work
- [ ] 4.6 Verify merge-to-website-build and merge-to-next-bundled-release behavior without manual registration

## 5. Acceptance evidence

- [ ] 5.1 Prove gallery field/order/deep-link parity and absence of runtime legacy fallbacks
- [ ] 5.2 Test unsafe archives, cross-project references and validation with no durable side effects
- [ ] 5.3 Test catalog format rejection separately from preserved package schema support
- [ ] 5.4 Record export repair attempts and setup usefulness; turn failures into fixtures and rerun
- [ ] 5.5 Verify website data parity, author membership, media fallbacks and page states against supplied UI designs
- [ ] 5.6 Record actual test commands/results and limitations; never mark a task complete from document validation alone

## 6. Deferred research

- [ ] 6.1 Verify website-to-self-hosted handoff, including authentication, base paths and catalog-version mismatch, before proposing destination-picker implementation

Website data work depends only on the catalog reader. Marketplace visual work additionally depends on supplied UI designs. Export and GitHub loading are not prerequisites for the website; guided submission needs the manual contribution and exact-head test paths.
