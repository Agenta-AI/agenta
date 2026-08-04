# Implementation divergences

## `queryMountDir` needs a public export

The plan says the pre-write check should call the same `queryMountDir` fetcher as
`mountDirQueryFamily`, but it only lists `mountDirQueryKey` among the new session-package barrel
exports. The fetcher is public in
`web/packages/agenta-entities/src/session/api/api.ts:636`, while the package's only public session
barrel does not export it beside the other mount reads
(`web/packages/agenta-entities/src/session/index.ts:22-26`).

The implementation also exports `queryMountDir` from `@agenta/entities/session`. This keeps the
pre-write check on the existing validated Fern boundary instead of duplicating the request in the
app layer or importing an unexported package-internal path.
