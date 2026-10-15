# Phase 0 spike runbook

This runbook tells the spike engineer how to run the ten Phase 0 checks in [tasks.md](tasks.md). The spike answers one question: does the design in [design.md](design.md) work on real infrastructure? It does not build the feature.

- Time-box: 5–8 engineer-days. Stop at the time-box and report what is known.
- Code: throwaway. Keep it on a separate branch (for example `spike/cloud-browser`) and do not merge it.
- Output: one file, `spike.md`, in this folder. Use the template at the end.
- Thresholds: no pass threshold was decided for times, sizes, or frame rates. Record the measured value. The team decides in check 0.10 whether the value is acceptable.

## Prerequisites

Collect all of these before day 1.

| Item | What you need | Used by |
| --- | --- | --- |
| Daytona account | `AGENTA_RUNNER_DAYTONA_API_KEY`; optional `AGENTA_RUNNER_DAYTONA_API_URL` and `AGENTA_RUNNER_DAYTONA_TARGET` (`services/runner/src/config/runner-config.ts:324-356`). | 0.1–0.9 |
| Sandbox snapshot | `AGENTA_RUNNER_DAYTONA_SNAPSHOT=agenta-agent-sandbox-v<N>`, where `<N>` is the `version` in `services/runner/config/sandbox-recipe.json` (2 at the time of writing). Confirm that the snapshot exists in your Daytona account (`services/runner/images/sandbox/daytona/README.md`). | 0.1, 0.2, 0.5–0.9 |
| Local stack | An EE dev stack: `load-env hosting/docker-compose/ee/.env.ee.dev`, then `bash ./hosting/docker-compose/run.sh --ee --dev --build` (see the root `AGENTS.md`). | 0.3, 0.6–0.9 |
| Cloud-like stack | A staging deployment behind the real cloud ingress, reachable from a phone. | 0.4, 0.5 |
| Two runner replicas | On the staging Helm release, set `agentRunner.replicas: 2`. Each replica needs a distinct `AGENTA_RUNNER_REPLICA_ID` (`hosting/kubernetes/helm/templates/runner-deployment.yaml:105-108`, `services/runner/src/config/runner-config.ts:419`). | 0.8 |
| Agents | One test agent per harness (Pi, Claude, Codex) in a test project, with a session and a schedule. | 0.3, 0.6 |
| Codecov | A GitHub account that can sign in to codecov.io, with at least one repository that has uploaded coverage. Read Codecov's terms of service first. | 0.3, 0.5 |
| Umami Cloud | An account on cloud.umami.is with one website. Install Umami's tracking script on that website and create some visits one day before the check. Read Umami's terms of service first. | 0.3, 0.5 |
| Phones | One iPhone (Safari) and one Android phone (Chrome), on mobile data, not office Wi-Fi. | 0.4, 0.5 |

## Checks

Each check lists its goal, its steps, what to record, and its pass rule.

### 0.1 Browser sandbox start time

- Goal: know how long a second sandbox takes before the first browser step.
- Steps:
  1. From a script that uses the runner's Daytona provider code (`services/runner/src/engines/sandbox_agent/provider.ts`), create a sandbox from the snapshot. Do not use the session pool.
  2. Start Chrome from `/opt/pw-browsers` with `--remote-debugging-port`, a desktop window size, and no `--enable-automation` flag.
  3. Load `https://example.com` over CDP.
- Record: the time from the create call to the loaded page, over 10 runs (minimum, median, maximum). Also record `navigator.webdriver` from the page.
- Pass: Chrome starts in the snapshot, and `navigator.webdriver` is `false`. The start time is recorded; it sets the first op's `timeout_ms` (task 2.2).

### 0.2 CDP through the Daytona preview proxy

- Goal: learn whether the runner can reach Chrome's CDP WebSocket from outside the sandbox.
- Steps:
  1. Get a preview URL for the debugging port, the same way the runner gets one for the daemon port (`provider.getUrl`, `services/runner/src/engines/sandbox_agent/daytona.ts:435-485`).
  2. Connect to the CDP WebSocket through it, keep the connection open for 30 minutes, and send one command per minute.
  3. If the connection fails or drops, start a small relay process inside the sandbox that exposes CDP over a path the proxy carries, and repeat step 2.
- Record: which path works (direct or relay), how long the connection stayed open, and any drop.
- Pass: one path holds a CDP connection for 30 minutes.

### 0.3 Tools in each harness

- Goal: prove that the tool kinds in D11 work in Pi, Claude, and Codex.
- Steps:
  1. Add one throwaway handler-mode op `navigate` and one `read_page` to the platform op catalog (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`), with a test handler that calls the browser from 0.1.
  2. Add a throwaway `wait_for_user` client tool.
  3. Run each test agent: navigate to the Codecov repository list and to the Umami dashboard, call `read_page`, then call `wait_for_user` and answer it from the web app.
- Record: per harness, whether each tool reached the handler, whether the pause and resume worked, and the `read_page` result size in KB on each page.
- Pass: all three tools work in all three harnesses. The result sizes are recorded against the 100 KB cap (`services/runner/src/tools/callback.ts:53`).

### 0.4 Live view through the cloud ingress

- Goal: prove that a CDP screencast and input reach a phone through the real ingress, with the session cookie.
- Steps:
  1. Add a throwaway WebSocket route to the API that authenticates inside the route with the session cookie and checks the `Origin` header. HTTP middleware does not run for WebSockets (`api/entrypoints/routers.py:619`).
  2. Relay `Page.startScreencast` frames to the phone, and the phone's taps and key presses back as `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, and `Input.insertText`.
  3. Keep the view open for 30 minutes on each phone.
- Record: frames per second, the delay from a tap to the visible result, any disconnect and its cause (idle timeout, ingress limit), and whether the phone keyboard opened.
- Pass: the stream works on both phones through the ingress, the cookie authenticates the WebSocket, and a request from another origin is refused.

### 0.5 Login, save, and reload on the two apps

- Goal: prove that a login done in the live view survives a new sandbox.
- Steps:
  1. In the live view from 0.4, sign in to Codecov with "Sign in with GitHub". Enter any GitHub verification code yourself.
  2. Sign in to Umami Cloud with email and password.
  3. Save the session state (cookies and storage) over CDP.
  4. Delete the sandbox. Start a new one, load the saved state, and open each app.
  5. Do the Codecov task (read the latest coverage % of one repository) and the Umami task (read yesterday's visitor count for one site).
  6. Repeat steps 4–5 once a day for the length of the spike.
- Record: whether each app stayed logged in after each reload, the egress IP of every sandbox, and any bot-detection page, CAPTCHA, or forced re-login.
- Pass: both apps stay logged in after at least one reload into a new sandbox. Egress IP changes and forced re-logins are recorded; they decide D3.

### 0.6 Pause and resume

- Goal: prove that `wait_for_user` pauses a turn while the browser keeps running, in chat and in a scheduled session.
- Steps:
  1. In a chat session, have the agent open a page and call `wait_for_user`. Wait 5 minutes. Answer it. Check that the agent continues on the same page.
  2. Run the same agent from a schedule. When it pauses, open the session from the session list in the web app, answer it, and check the same thing.
- Record: whether each case resumed on the same page, and whether the scheduled session showed the pending interaction in the web app.
- Pass: both cases resume on the same page. If the scheduled case does not show or accept the answer, record that; it changes R6 and R18.

### 0.7 Agent sandbox cannot reach the browser sandbox

- Goal: prove the isolation that D1 depends on.
- Steps: from the agent sandbox's shell, try to reach the browser sandbox by its preview URL without a token, by any private address you can find, and by the debugging port.
- Record: each attempt and its result.
- Pass: every attempt fails.

### 0.8 Two runner replicas

- Goal: prove that routing by session ID keeps the browser on the replica that owns the agent session (D19).
- Steps:
  1. On the staging stack with two replicas, start a session that uses the browser.
  2. Send a browser call through the API and confirm which replica serves it.
  3. Force one call to arrive at the other replica and confirm that it is forwarded to the owning replica and acts on the same page.
  4. End the turn and confirm that the session-state save runs on the owning replica.
- Record: the replica for each call and for the save.
- Pass: every call and the save run on the replica that owns the session.

### 0.9 Allowlist coverage

- Goal: prove that CDP request interception can enforce D7 on every target.
- Steps: with an allowlist of one host, use `Target.setAutoAttach` and `Fetch` interception, and try each case:
  1. a top-level navigation to another host;
  2. an iframe on another host;
  3. a popup (`window.open`) to another host;
  4. a file download from another host;
  5. an IP literal, such as `http://169.254.169.254/`;
  6. `http://localhost:9222/`;
  7. a public host name that resolves to a private address.
- Record: blocked or loaded, per case.
- Pass: all seven are blocked.

### 0.11 In-sandbox proxy (D26)

- Goal: prove that Chrome sends every connection through the proxy, so the proxy's address check is the one that counts (F-027).
- Steps:
  1. Write a test forward proxy that handles plain HTTP and `CONNECT`, resolves each host once, refuses private, link-local, and loopback addresses, and connects to the address it checked. Log every request.
  2. Start Chrome with `--proxy-server=http://127.0.0.1:<port>`, `--proxy-bypass-list=<-loopback>`, and `--webrtc-ip-handling-policy=disable_non_proxied_udp`. (`--force-webrtc-ip-handling-policy` has no effect in Chrome 141.)
  3. From an allowed page, try: a navigation, an iframe, a popup, a download, a `fetch`, a WebSocket, a `navigator.sendBeacon`, and a WebRTC connection with a STUN server.
  4. Give the proxy a resolver that answers a public address first and a private address on the next lookup for one test name. Load that name twice.
- Record: for each request kind, whether the proxy saw it; whether the rebinding name was refused; whether any UDP left outside the proxy.
- Pass: the proxy sees every request kind, refuses the private answer, and no UDP leaves outside it.

### 0.10 Report and re-estimate

1. Fill in `spike.md` from the template below.
2. For each failed check, update [design.md](design.md) before Phase 1.
3. Re-estimate Phases 1–8 in `design.md`.

## `spike.md` template

```markdown
# Phase 0 spike results

- Dates: <start> to <end>
- Engineer: <name>
- Snapshot: agenta-agent-sandbox-v<N>

| Check | Result | Measured values | Notes |
| --- | --- | --- | --- |
| 0.1 Start time | pass / fail | min / median / max seconds; webdriver = <value> | |
| 0.2 CDP via proxy | direct / relay / fail | connection held <minutes> | |
| 0.3 Harness tools | Pi <ok/fail>, Claude <ok/fail>, Codex <ok/fail> | read_page KB: Codecov <n>, Umami <n> | |
| 0.4 Live view | pass / fail | fps <n>, tap delay <ms>, disconnects <n> | iPhone / Android |
| 0.5 Login reload | Codecov <ok/fail>, Umami <ok/fail> | egress IPs: <list>; re-logins: <n> | |
| 0.6 Pause/resume | chat <ok/fail>, scheduled <ok/fail> | | |
| 0.7 Isolation | pass / fail | | |
| 0.8 Replicas | pass / fail | | |
| 0.9 Allowlist | <n>/7 blocked | | |
| 0.11 Proxy | pass / fail | request kinds seen <n>/8; rebinding refused <yes/no>; UDP leak <yes/no> | |

## Design changes

- <check>: <what changes in design.md, or "none">

## New estimate

| Phase | Before | After |
| --- | --- | --- |
| 1–8 | 72–106 | <range> |
```
