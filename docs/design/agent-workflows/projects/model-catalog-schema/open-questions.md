# Open questions for the owner and CTO

Each question states the decision, the options, and a recommendation. Answer inline.

## 1. `ratings.cost` direction and name

The scale reads "higher is better" on every axis, so `cost: 5` means cheapest. That is
consistent for the meter but reads oddly in isolation ("cost 5" sounds expensive). Options:
(a) keep `cost`, documented as cost-efficiency; (b) rename to `economy` or `value` so the
direction is self-evident. Recommendation: rename to `economy`. It removes the only field whose
name fights its direction. Kept `cost` in the current draft to match the owner's wording.

## 2. Flat list versus provider-keyed map for `model_catalog`

The draft recommends a flat `List[ModelCatalogEntry]` (normalized, `provider` on each entry). The
lower-migration alternative is `Dict[provider, List[ModelCatalogEntry]]`, which mirrors the
current `models` shape and needs a smaller frontend diff. Recommendation: flat list. `provider`
has one source, and the frontend `groupBy` is one line. Confirm you are fine with the slightly
larger frontend change for the cleaner shape.

## 3. Should `models` (ids-only) survive as a derived view after cutover?

Step 3 of the migration removes `models`. If any external or future reader wants a plain id list,
we can keep `models` as a derived, deprecated view (the advertised entries' ids). Recommendation:
remove it; regenerate on demand if a reader appears. Keeping two shapes invites drift.

## 4. Where the curated ratings and descriptions live for Pi

The draft keeps Pi curation in a separate overlay (`pi_models.curated.json`) so regeneration never
clobbers human judgments. The alternative is a single Pi file the skill rewrites carefully,
preserving curated fields. Recommendation: the overlay. A generator that must preserve hand edits
in the file it overwrites is a maintenance trap.

## 5. Does the skill's live Claude probe run in CI, or only by hand?

The probe needs an authenticated Claude session, which CI does not have cheaply. Recommendation:
the drift report's static half (advertised versus catalogued) runs in CI as a warning; the live
half (versus the accepted set) runs by hand or on a periodic job with credentials. Confirm you do
not want the live probe gating merges.

## 6. Do we advertise Fable once the probe confirms its id?

The schema supports `advertised: false` (curated, accepted, not surfaced by default). Whether to
flip Fable to `advertised: true` is a product call, not a schema call. Recommendation: keep it
`advertised: false` until you decide to promote it. The schema carries it either way.
</content>
