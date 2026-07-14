# Operating the stack

The operational mechanics behind `hosting/docker-compose/run.sh`. The docs cover the happy
path; this covers the parts that bite.

## run.sh: flags and what they resolve to

`run.sh` lives at `hosting/docker-compose/run.sh`. Run it from the repo root:

```bash
bash ./hosting/docker-compose/run.sh --oss --gh --build
```

It derives a **stage** from your flags and picks the matching Compose file
`hosting/docker-compose/<edition>/docker-compose.<stage>.yml`:

- `--dev` -> stage `dev`
- `--gh --local` -> stage `gh.local`
- `--gh --ssl` -> stage `gh.ssl` (OSS only)
- `--gh` -> stage `gh`

Other flags: `--build` (build before up), `--no-cache` (clean build, needs `--build`),
`--pull` / `--no-pull` (gh pulls by default, dev does not), `--down` (stop, keep volumes),
`--nuke` (stop and drop volumes), `--no-web` (skip the web container), `--no-tunnel`
(disable the Composio trigger tunnel; use it when the host already has a public ingress).

## Env-file resolution: the bare-filename trap

`run.sh` resolves `--env-file` (alias `-e`, `--env`) two ways, and this is easy to get
wrong:

- A **bare filename** (no slash) resolves **relative to the edition folder**:
  `--env-file .env.oss.gh.custom` -> `hosting/docker-compose/oss/.env.oss.gh.custom`.
- A **path** (contains a slash) is used **as-is**:
  `--env-file hosting/docker-compose/oss/.env.oss.gh.custom` or an absolute path.

If you pass no `--env-file`, `run.sh` defaults to `.env.<edition>.<stage>` in the edition
folder, except that **`gh.local` reuses the `gh` env family** (`.env.<edition>.gh`), because
the two stages share URLs and only differ in where the images come from.

`run.sh` fails loud if the resolved env file is missing, rather than letting Compose fall
back to its built-in port-80 default (which would make every web `/api` call 404). If you
see "Env file not found", create the file or fix the path.

## Multiple isolated instances on one host

Each stack is namespaced by `COMPOSE_PROJECT_NAME` (default `agenta-<edition>-<stage>`, e.g.
`agenta-oss-gh`). The Traefik provider constraint keys off it, so two stacks with different
project names do not see each other's containers.

To run a second isolated instance, give it a different `COMPOSE_PROJECT_NAME`, a separate
env file, and non-colliding published ports (`TRAEFIK_PORT`, `POSTGRES_PORT`,
`TRAEFIK_UI_PORT`). Then point `--env-file` at that env file.

## Self-hosting a non-released branch

Published `--gh` images track released main. To run code that is not released yet, build the
images from your working tree:

```bash
bash ./hosting/docker-compose/run.sh --oss --gh --local --build
```

`--local` switches to the `gh.local` Compose file, which builds from your checkout instead
of pulling. Rebuild (`--build`, or `--no-cache` for a clean build) whenever you change code
that is baked into an image.

## Recreate vs rebuild: the rule that saves you an afternoon

The web image reads its URLs (`AGENTA_WEB_URL`, the API URL, and friends) **at container
start**, not at build time. This changes what a given edit requires:

- **Changed a URL or any runtime env var** -> **recreate** the container, do not rebuild.
  Update the env file and re-run `run.sh` (or `docker compose up -d --force-recreate <svc>`).
  A rebuild is wasted work.
- **Changed `entrypoint.sh`, baked assets, or dependencies** -> **rebuild** the image
  (`--build`, or `--no-cache`). A recreate alone runs the old image.

If a URL change "did not take", you rebuilt when you needed to recreate, or the browser
cached the old bundle. Recreate and hard-reload.
</content>
