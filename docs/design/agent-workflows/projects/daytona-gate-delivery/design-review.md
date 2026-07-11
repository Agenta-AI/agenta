# Design review

The owner review identified one central flaw in the first draft: it treated an unexplained
transport difference as a reason to skip root-cause work and build a second permission
channel. The revised design resolves that uncertainty first.

## Findings and resolutions

### 1. “Daytona preview proxy” was undefined

The revised [research.md](research.md) defines it as signed, authenticated ingress to
sandbox port 3000. It explains target resolution, the Go reverse proxy, the auth cookie,
and the difference between the preview proxy and outbound secret substitution.

### 2. The draft blamed the proxy without evidence

The revised research rules that out. The Daytona snapshot inherits `pi-acp` 0.0.23, which
does not translate Pi extension UI events into ACP permission requests. Local uses 0.0.29,
which does. The proxy never receives the missing request.

### 3. Uncertainty was used to justify a decision

The revised plan turns uncertainty into an ordered test. It checks the deployed private
adapter version first, rebuilds with a pin, and instruments transport only if a corrected
adapter still fails. Option B now has an explicit evidence gate.

### 4. Warm and cold behavior were mixed with transport

The revised research and plan separate them. A live sandbox can retain and answer the ACP
permission id. A stopped or dead sandbox cannot retain a pending RPC on any channel. The
cold path uses durable decisions and a reissued call.

### 5. The file relay would recreate a permission plane

Agreed. The revised recommendation removes it. The existing ACP path is the one permission
plane after adapter parity is restored. A file gate is only a contingency after a focused
transport failure is proved.

### 6. Option C's dependency was misstated

Option C does not depend on Option B. Static allow and deny can skip a round-trip, while
residual decisions use whichever runner channel works. With Option A, that channel is ACP.
The revision defers C until latency data justifies the extra policy surface.

### 7. MCP scope was conflated

The revised research distinguishes Pi extension tools, the Pi execution relay, internal
gateway MCP, user HTTP MCP, and disabled stdio MCP. It also states that F-018 proves a Pi
adapter failure, not a Claude failure.

## Review outcome

The first recommendation, Option C plus a narrowed Option B, is withdrawn. The current
recommendation is Option A through adapter parity, followed by focused live verification.
No new interface is proposed.
