# Backend Fix Notes

## Where the fix lives

File: `api/oss/src/core/evaluations/service.py`

## Metrics refresh schema inference

When `_refresh_metrics()` sees an evaluator step with no `schemas.outputs` and no
`service.format`, it defers metric key creation until after trace ids are collected.
It then queries a small sample of traces and infers a JSON schema from
`attributes.ag.data.outputs` using `genson.SchemaBuilder`.

This schema is not stored in the evaluator revision. It is used only for the current
refresh.

## Run mapping repair

The scenario drill in table uses `run.data.mappings`. When evaluator schemas are missing
at run creation, the run is created with a fallback mapping:

```
column.name = "outputs"
step.path   = "attributes.ag.data.outputs.outputs"
```

That path does not exist. After schema inference, we now rebuild the mappings for the
affected evaluator step and add explicit mappings for each inferred output field. This
creates columns like:

```
score   -> attributes.ag.data.outputs.score
success -> attributes.ag.data.outputs.success
```

## Mapping dedupe

Metrics refresh can run more than once. Without protection, each refresh would append
duplicate mappings. The repair logic now dedupes by the tuple:

```
(step.key, column.kind, column.name, step.path)
```

## Safe edit_run update

The `edit_run` call must include `status` and other non nullable fields. We now pass
`name`, `description`, `status`, and `flags` when updating run mappings. This prevents
database errors during refresh.

## Trade offs

- Extra trace query only when schema is missing.
- Schema is not persisted, so refresh may re infer if evaluator revisions remain
  schema free.
