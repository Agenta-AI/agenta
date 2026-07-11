# Research

## 1. ACP traffic is already application bidirectional

The outer runner connects to sandbox-agent through Daytona's signed preview URL. The ACP
HTTP client uses:

- one POST per runner-to-daemon JSON-RPC envelope;
- one persistent SSE GET for daemon-to-runner traffic;
- POST for the runner's response to a server-initiated request.

Notifications such as `session/update` and reverse requests such as
`session/request_permission` use the same inbound SSE parser. Daytona authentication adds
a cookie jar and long timeout; it does not translate ACP methods.

PR #5218 found the Pi failure one layer earlier. The snapshot inherited `pi-acp` 0.0.23,
which had no `extension_ui_request` bridge. Pi 0.0.29 creates the ACP permission request,
and the rebuilt snapshot delivered an ask-mode `interaction_request`.

Conclusion: runner-initiated TCP does not mean runner-only application messages. NetBird is
not required for Pi or Claude permission delivery.

## 2. Capability and transport matrix

| Capability | Pi local | Pi Daytona | Claude local | Claude Daytona |
| --- | --- | --- | --- | --- |
| Builtin or native permission | ACP | ACP after adapter parity | ACP | ACP |
| Agenta custom or gateway tools | Extension plus file relay | Extension plus Daytona filesystem relay | Runner-loopback HTTP MCP | Rejected before session |
| User remote HTTP MCP | Rejected | Rejected | Supported with HTTPS and SSRF checks | Supported when sandbox egress reaches the URL |
| User stdio MCP | Rejected | Rejected | Rejected | Rejected |
| Internal runner tool-MCP | Not used | Not used | Bound to `127.0.0.1` | Not exposed to sandbox |
| Direct sandbox OTLP to Agenta | Not needed | Not used | Not needed | Not used |

The user comment said "Cloudflare" while asking about harnesses. This workspace interprets
that as Claude. Cloudflare is a tunnel provider, not an agent harness.

### Pi custom and gateway tools

The Pi extension advertises resolved tools and writes execution requests inside the
sandbox. The runner polls those files through local or Daytona filesystem APIs, evaluates
permission again, and executes runner-side with runner credentials. No sandbox-to-runner
TCP listener exists or is needed.

### User HTTP MCP

For capable non-Pi harnesses, the runner converts user HTTP MCP entries and passes the
remote HTTPS URL to the harness. Daytona Claude dials that user server directly. Named
secrets travel in request headers. Pi rejects user MCP today. All harnesses reject user
stdio MCP.

### Internal gateway-tool MCP

For local non-Pi runs, Agenta starts a stateless Streamable HTTP MCP server bound to the
runner's `127.0.0.1`. This server executes credentialed gateway actions. Daytona loopback
belongs to the sandbox, so non-Pi remote custom tools are rejected.

NetBird would provide IP reachability only after Agenta rebinds or proxies the service. The
current no-auth assumption is safe only because the listener is loopback. Remote exposure
requires per-run authentication and ACLs.

## 3. Mount endpoint flow

Durable mounts use an S3-compatible object store. geesefs runs inside Daytona.

Current flow:

1. the API signs a mount and returns temporary credentials plus the configured S3
   endpoint;
2. the runner decides whether the endpoint is reachable from the sandbox;
3. a public endpoint is passed directly to geesefs;
4. a private endpoint triggers `discoverTunnelEndpoint`;
5. that function queries ngrok's internal API and returns its public URL;
6. the URL overrides geesefs's endpoint only.

The user is correct that geesefs only needs a URL. Provider discovery belongs in endpoint
resolution, not in the mounting primitive. A random Cloudflare hostname creates the same
discovery need as ngrok unless the sidecar exports a normalized endpoint.

## 4. Storage authentication

### Bundled SeaweedFS

The API signs a web-identity JWT and exchanges it through SeaweedFS STS for short-lived
credentials. The inline session policy restricts the credential to the mount's bucket and
project or mount prefix. geesefs receives the access key, secret, and session token.

### External S3-compatible storage

The API uses the configured backend credentials to request temporary, prefix-scoped
credentials through the backend's STS-compatible path. geesefs still signs S3 requests.

### Public endpoint implications

A public tunnel exposes the S3 and STS network surface. The ngrok authtoken authenticates
the tunnel process; it does not put HTTP authentication in front of SeaweedFS.

Agenta does not configure anonymous SeaweedFS object access. Knowing the URL does not grant
data access without valid S3 credentials. SeaweedFS can be configured for anonymous or
public reads, but that is not the Agenta default.

Public reachability still matters for TLS, rate limiting, denial of service, vulnerability
exposure, and endpoint discovery. Storage authentication and network exposure are separate
controls.

## 5. Deployment topology

The previous claim that production is public and unaffected was unsupported.

- Compose commonly uses private Docker DNS for bundled SeaweedFS.
- Railway configuration uses a private service domain for SeaweedFS.
- The Helm chart exposes bundled SeaweedFS as a ClusterIP service.
- External S3, R2, or another publicly reachable endpoint needs no tunnel.

The relevant axis is public versus private endpoint, not production versus development.

## 6. Tunnel readiness

`discoverTunnelEndpoint` performs one fetch and returns null on a startup race, HTTP
failure, or missing tunnel. The caller can then continue without the requested durable
mount.

A Cloudflare process can have the same race before it assigns a hostname. "No token
required" removes one provisioning dependency but does not mean "always ready."

The endpoint contract needs bounded polling, a route probe, and a provisioning error when a
private durable store cannot be exposed. The existing post-mount liveness check covers a
different stage after geesefs starts.

## 7. Cloudflare Quick Tunnel limits

Cloudflare's official Quick Tunnel page documents:

- testing and development use;
- no SLA;
- one connection;
- no SSE support;
- 200 concurrent in-flight requests, with 429 beyond the cap.

Source: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

The 200 cap is not 200 requests per minute. A long S3 upload part consumes one slot while it
is active. GeeseFS can issue parallel flushes, multipart uploads, metadata requests, and
reads. Several mounts share the sidecar's cap.

Cloudflare documents a 100 MB upload limit for Free-plan proxied requests elsewhere, but
the Quick Tunnel page does not state that `trycloudflare.com` inherits it. GeeseFS later
multipart tiers can exceed 100 MiB. Test the actual path and cap part sizes if required.
Do not record 100 MB as a verified Quick Tunnel fact before that test.

## 8. ngrok comparison

ngrok's current free limits are expressed as 4,000 HTTP requests per minute, 20,000
requests per month, and 1 GB outbound transfer per month. It does not document the same
200-concurrent-request cap.

Source: [ngrok pricing and limits](https://ngrok.com/docs/pricing-limits).

The products can fail different workloads. A short concurrency burst may fit ngrok while a
long-lived S3 filesystem exhausts monthly requests or bandwidth. A Quick Tunnel may avoid
those account quotas but hit its concurrency or testing-service constraints. Measure
geesefs instead of comparing one headline number.

## 9. NetBird topology

A NetBird peer exposes its own network namespace. A peer in the runner container does not
automatically expose:

- the sibling SeaweedFS container;
- a Kubernetes ClusterIP;
- a service bound to runner loopback.

SeaweedFS needs a separate peer, a routing peer with a scoped network resource, or a proxy
bound to the runner's NetBird address. NetBird routing peers must already reach the
resource they route. See
[how routing peers work](https://docs.netbird.io/manage/networks/how-routing-peers-work).

Internal MCP needs an overlay-bound listener or proxy plus per-run authentication. Opening
the current unauthenticated credentialed tool server beyond loopback would be unsafe.

## 10. NetBird ACL baseline

A new NetBird account includes a default all-to-all policy. The first untrusted sandbox
must not enroll under that policy.

The minimum baseline is:

- delete the default policy;
- create the per-run sandbox group and service policy first;
- allow one-way TCP only to the paired resource and exact port;
- do not allow sandbox-to-sandbox traffic;
- avoid broad Docker-subnet routes;
- delete the peer and policy objects explicitly on teardown.

NetBird policies are stateful, so return traffic follows an allowed connection without a
reverse policy. Source: [NetBird access control](https://docs.netbird.io/manage/access-control).

## 11. Setup-key security

A setup key delivered as a sandbox environment variable is visible to processes in that
sandbox and may leak through diagnostics.

Use a one-off key with usage limit 1, short expiry, ephemeral peer, and a run-scoped
auto-group. Deliver it through the Daytona control plane as a temporary 0600 file, use
`netbird up --setup-key-file`, delete the file, verify the peer, and revoke the key.
Delete the enrolled peer separately because key revocation does not disconnect it.

This limits replay. It cannot hide the key from an arbitrary process that controls the
sandbox during enrollment.

Sources:
[setup keys](https://docs.netbird.io/manage/peers/register-machines-using-setup-keys),
[NetBird CLI](https://docs.netbird.io/get-started/cli).

## 12. Daytona feasibility

Daytona documents NetBird as a VPN connection that requires its applicable higher account
tier. That makes an overlay a conditional capability, not a universal self-host default.
A confirmation run would still need to measure TUN availability, join time, reconnect,
egress policy interaction, and peer cleanup.

Source: [Daytona VPN connections](https://www.daytona.io/docs/en/vpn-connections/).
