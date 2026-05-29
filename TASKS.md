# Agenta MCP Server — Progress

Status: Release cleanup complete
Last updated: 2026-05-29
Summary: MCP package, docs, OSS/EE Compose snippets, and validation are complete for the v1 internal-first release scope.

## Phase 1 — Research        [ 6/6 subsections ]
- [x] 1A Spec inventory + auth
- [x] 1B Uniform /simple pattern confirmed
- [x] 1C Create payload shapes confirmed
- [x] 1D Under-specified items resolved (eval steps, evaluator settings, app schema, windowing)
- [x] 1E Live read validation
- [x] 1F Hosting facts confirmed
- GATE: [x] no INFERRED/OPEN item backs a v1 tool

## Phase 2 — Implementation   [ 20/20 tools + artifacts ]
- [x] config.py / client.py / AgentaError
- [x] Vertical slice (list/get/create application) implemented
- [x] Applications (7)  - [x] Evaluators (5)  - [x] Testsets (4)  - [x] Evaluations (3)  - [x] Environments (1)
- [x] Dockerfile  - [x] compose snippet  - [x] README  - [x] .env.example
- [x] Non-Compose deployment manifest removed from v1 scope
- GATE: [x] validation suite passes for v1 release checks

## Pre-release checklist
- [x] Replace the public docs page at `docs/docs/misc/05-mcp-server.mdx` so it describes the Agenta authoring MCP.
- [x] Update `docs/blog/entries/mcp-server.mdx` so it announces the authoring MCP capability.
- [x] Add an EE Docker Compose snippet at `clients/mcp-python/deploy/compose.ee.snippet.yml`.
- [x] Document the optional EE MCP service in `hosting/docker-compose/ee/README.md`.
- [x] Decide the v1 distribution path: install from source and build Docker locally. No prebuilt image is documented until release automation exists.
- [x] Update README examples to use `python3`.
- [x] Document `.env` usage explicitly.
- [x] Keep public multi-tenant OAuth out of v1; track it separately as v2 client-to-MCP and MCP-to-Agenta per-user auth work.

## Validation completed
- [x] Python compile check: `python3 -m compileall -q clients/mcp-python/src clients/mcp-python/scripts`
- [x] Package install in a temp virtualenv: `python -m pip install -e clients/mcp-python`
- [x] Static MCP registration: 20 tools, all with descriptions and input schemas.
- [x] Live EU smoke test with project API key: applications query returned `count=1`; evaluator templates returned `count=17`.
- [x] Docker image build: `docker build -t agenta-mcp-review clients/mcp-python`

## Decisions log
- Package location will be `clients/mcp-python/` to match the requested client layout and keep the MCP server standalone from API/frontend code.

- Research gate passed: no inferred/open item backs a v1 tool; unresolved live validation is covered by the smoke script.
- Implementation decision: v1 upload_testset_file follows confirmed multipart schema fields (`file`, `file_type`, and testset metadata form fields).
- Follow-up documentation update: README files now include explicit build/run steps and Agenta platform connection instructions.
- Release scope decision: Compose is the only self-hosted deployment artifact in this package for v1.
