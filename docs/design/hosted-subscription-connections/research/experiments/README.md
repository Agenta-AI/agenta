# Storage mount experiments

This folder holds experiments for several research tracks. This file documents only the storage
mount pair, `run.sh` and `mount-semantics.mjs`. Other scripts here belong to other tracks.

`run.sh` and `mount-semantics.mjs` measure what a geesefs mount over the object store does with
one small JSON file that several processes rewrite. They run on the real mount path with the
runner's production flags, not on a local directory.

Findings and results: [../storage-mounts.md](../storage-mounts.md).

## Run

```
bash run.sh
```

Defaults target the compose stack `agenta-ee-dev-hostedsub` and its runner container. Override
with `--container <name>`, `--env-file <path>`, or `--out <dir>`.

Optional environment:

- `EXP_CELLS` runs a subset, for example `EXP_CELLS=7_conditional_put`.
- `EXP_EXTRA_GEESEFS_ARGS` appends diagnostic geesefs flags, for example `--debug_s3`. Leave it
  empty for a measurement run, because it changes the argv away from production.

## What the scripts do

`run.sh` reads the store master keys from the stack env file and passes them to the container
through `docker exec -e`. It never prints a key and never writes one to a file. It copies
`mount-semantics.mjs` in, runs it, copies the results out, then unmounts and deletes everything it
created inside the container.

`mount-semantics.mjs` mounts the same prefix two or three times and runs eight cells. It writes
under `research/storage-mounts/<run id>` in the bucket, which is outside the `mounts/` prefix, so
it can never touch a real session or agent mount.

## Safety

Do not point these scripts at a real session prefix. Delete the `research/storage-mounts/` objects
when the design is settled.
