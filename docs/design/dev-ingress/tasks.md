# The development ingress — tasks

Specs: [specs.md](specs.md). Research: [research.md](research.md).

Branch `chore/dev-ingress-tunnel`, branched from `main`. One package, no breakdown —
see `specs.md` for why.

## Code — done

- [x] `ngrok http traefik:80` in `hosting/docker-compose/oss/docker-compose.dev.yml`
      and the EE twin, with `NGROK_DOMAIN` optional and `depends_on` moved from
      `seaweedfs` to `traefik`.
- [x] `discoverTunnelEndpoint` takes `storeEndpoint` and matches a tunnel by its
      upstream host and port; returns null when none matches rather than another
      tunnel's URL.
- [x] Both call sites in `environment.ts` pass the store endpoint they already hold.
- [x] Three tests: the two-tunnel case picks the store's; no matching tunnel returns
      null; the upstream matches however the agent spells it.
- [x] `NGROK_AUTHTOKEN` / `NGROK_DOMAIN` documented in both dev env examples, with the
      store consequence stated.
- [x] `pnpm run typecheck` clean; `pnpm test` 2117 passed. The 19 failures in
      `commit-authorization`, `sandbox-agent-acp-interactions` and `workspace-import`
      are pre-existing — confirmed by running the suite on the base commit with this
      work stashed.
- [x] `docker compose config` validates for both editions.

## Deploy and verify — not mine to run

The operator deploys this branch from `main` and checks the following. Each item is
here because it can fail quietly.

- [ ] Set `NGROK_AUTHTOKEN`, and `NGROK_DOMAIN` if a reserved domain exists.
- [ ] Bring the stack up with the tunnel profile on (it is on by default).
- [ ] **The tunnel points at the ingress.** `curl https://<tunnel>/api/health` answers
      from the API. If it answers HTML, it reached `web` and the prefix is wrong.
- [ ] **The agent API lists one tunnel whose upstream is traefik.** `curl
      http://localhost:4040/api/tunnels` from inside the network, or read the ngrok
      log line. The upstream is what the selector now matches on.
- [ ] **With no token set, nothing is published and the container does not loop.** It
      should exit 0 once and stay exited.
- [ ] **A local-sandbox agent run still works.** Local sandboxes never tunnelled, so
      this is the regression check that the compose edit broke nothing else.
- [ ] **A Daytona run with the bundled store refuses the mount out loud.** Expect the
      `WARN durable cwd mount SKIPPED` line naming the cause, and the run continuing
      on throwaway storage. Silence here is the failure, not the refusal.
- [ ] **A Daytona run with a public store endpoint mounts normally.** Set
      `AGENTA_STORE_ENDPOINT_URL` to a public store first. This is the path production
      uses and the one that must keep working.

## Then

- [ ] Raise the PR against `main`. **The operator does this, not the agent.**
- [ ] Merge into `channels-m4`, which needs it for platform events.
- [ ] Merge into the gateways branch, which needs it for the client-identity fetch.
      Its `D26` already says the OAuth **redirect** needs nothing, and that stays true
      — do not let the merge imply otherwise.

## Watch for

- **Do not add a second tunnel to this agent without checking the selector.** It is
  precise now, and that is the only reason a second endpoint is safe. The
  remote-tools-delivery design wants one.
- **Do not route the store on a subpath.** S3 signatures cover the path, so a stripped
  prefix invalidates every request. The store gets a host, never a prefix.
- **Do not write a routing rule against a literal bucket name.**
  `AGENTA_STORE_BUCKET` is configuration and its defaults already disagree across
  files.
- **A rotating tunnel address invalidates anything registered with a provider.** That
  is what makes a reserved domain worth it rather than a nicety.
