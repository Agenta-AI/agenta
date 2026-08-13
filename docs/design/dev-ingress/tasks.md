# The development ingress — tasks

Specs: [specs.md](specs.md). Research: [research.md](research.md).

Branch `chore/dev-ingress-tunnel`, branched from `main`. One package, no breakdown —
see `specs.md` for why.

## Code — done

- [x] New `ngrok-ingress` service in `hosting/docker-compose/oss/docker-compose.dev.yml`
      and the EE twin, forwarding to `traefik:80`, on the `with-tunnel` profile, gated
      on `NGROK_AUTHTOKEN`, with `NGROK_INGRESS_DOMAIN` optional.
- [x] `ngrok` renamed to **`ngrok-mounts`**, so each service is named for what it
      publishes. Its target, token gate, comments and `depends_on` are otherwise
      unchanged from `main`.
- [x] The runner's compiled-in daemon address follows the rename:
      `http://ngrok:4040` becomes `http://ngrok-mounts:4040`.
- [x] `AGENTA_MOUNTS_TUNNEL_API` removed. It overrode that address and was never set
      anywhere; tests inject through the `deps` seam, which stays.
- [x] `discoverTunnelEndpoint` takes `storeEndpoint` and matches a tunnel by its
      upstream host and port; returns null when none matches rather than another
      tunnel's URL.
- [x] Both call sites in `environment.ts` pass the store endpoint they already hold.
- [x] Three tests: the two-tunnel case picks the store's; no matching tunnel returns
      null; the upstream matches however the agent spells it.
- [x] `NGROK_INGRESS_DOMAIN` documented in both dev env examples, beside the existing
      `NGROK_AUTHTOKEN` text, which is left as it was.
- [x] `docker compose config` validates for both editions with both tunnels defined.
- [x] `pnpm run typecheck` clean; `pnpm test` 2117 passed. The 19 failures in
      `commit-authorization`, `sandbox-agent-acp-interactions` and `workspace-import`
      are pre-existing — confirmed by running the suite on the base commit with this
      work stashed.

## Deploy and verify — not mine to run

Each item is here because it can fail quietly.

- [ ] Set `NGROK_AUTHTOKEN`, and `NGROK_INGRESS_DOMAIN` if a reserved domain exists.
- [ ] Bring the stack up with the tunnel profile on (it is on by default), and pass
      `--remove-orphans` the first time: the rename leaves an orphaned `ngrok`
      container behind otherwise, which is confusing rather than harmful.
- [ ] **Both tunnels come up.** Two agent sessions are needed. If the plan allows only
      one, the second will fail to start — that is the case to watch for, and the
      fallback is a single agent with two named endpoints.
- [ ] **The ingress tunnel reaches the API.** `curl https://<ngrok-ingress-url>/api/health`
      answers from the API. If it answers HTML, it reached `web` and the path is wrong.
- [ ] **The store tunnel still reaches the store**, and the runner still finds it:
      `curl http://ngrok-mounts:4040/api/tunnels` from inside the network lists one tunnel
      whose upstream is `seaweedfs:8333`.
- [ ] **A Daytona run with the bundled store still mounts its durable folder.** This is
      the regression that matters most: it is what the first draft of this change broke.
      Expect no `mount SKIPPED` warning.
- [ ] **A local-sandbox agent run still works.** Local sandboxes never tunnelled, so
      this proves the compose edit broke nothing else.
- [ ] **With no token set, neither service publishes anything and neither loops.** Each
      should exit 0 once and stay exited.

## Then

- [ ] Raise the PR against `main`. **The operator does this, not the agent.**
- [ ] Merge into `channels-m4`, which needs it for platform events.
- [ ] Merge into the gateways branch, which needs it for the client-identity fetch.
      Its `D26` already says the OAuth **redirect** needs nothing, and that stays true
      — do not let the merge imply otherwise.

## Watch for

- **Do not repoint or remove the store tunnel.** The first draft of this change did,
  and it silently cost Daytona sandboxes their durable folder. The two tunnels are
  independent on purpose.
- **If you rename either service again, move the runner's default with it.** The
  service name is the only address the runner has for the store's tunnel daemon, so a
  rename alone breaks discovery silently.
- **Do not route the store on a subpath.** S3 signatures cover the path, so a stripped
  prefix invalidates every request. The store gets a host, never a prefix.
- **Do not write a routing rule against a literal bucket name.**
  `AGENTA_STORE_BUCKET` is configuration and its defaults already disagree across
  files.
- **A rotating tunnel address invalidates anything registered with a provider.** That
  is what makes a reserved domain worth it rather than a nicety.
