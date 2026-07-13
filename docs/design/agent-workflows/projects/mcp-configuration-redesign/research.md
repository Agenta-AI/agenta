# Research

## Current wiring

The author config is `MCPServerConfig` in
`sdks/python/agenta/sdk/agents/mcp/models.py`. It currently contains `transport`, `command`,
`args`, `env`, `url`, `secrets`, `tools`, and `permission` in one flat object. The UI mirrors that
shape and seeds new entries as stdio.

The service resolver is guarded by `AGENTA_AGENT_MCPS_ENABLED`. It resolves vault names before
creating the `/run` request. The runner then:

- rejects any user MCP on Pi;
- rejects user stdio for every harness;
- accepts remote HTTP only for non-Pi harnesses after URL and SSRF validation;
- converts the resolved `env` map into HTTP headers;
- passes the HTTP entry into Claude ACP session initialization.

The installed Claude adapter maps server name, URL, and headers. It does not enforce the public
`tools` list. The SDK has MCP status and reconnect surfaces, but Agenta does not publish them.

## Stdio conclusion

There is no supported public stdio cell.

| Use | Status | Contract |
| --- | --- | --- |
| User stdio on Claude local | Rejected before session start | Public legacy shape |
| User stdio on Claude Daytona | Rejected before session start | Public legacy shape |
| User stdio on Pi local or Daytona | Rejected because all user MCP is rejected | Public legacy shape |
| Internal Claude Daytona shim | Active trusted delivery mechanism | Private runner `McpServerStdio` |

The private shim does not consume `MCPServerConfig`. Public stdio can therefore be removed without
removing the internal shim. The shared word "stdio" describes a protocol transport, not a shared
product capability.

## UI capability source

The frontend already consumes per-harness capabilities from the workflow harness catalog. That
catalog currently describes providers, deployments, connection modes, model naming, and models.
It does not describe user MCP support, and the service deployment flag is not published to the
editor.

The UI must not read a build-time browser environment variable for this. The capability is a
runtime conjunction:

```text
deployment enables user MCP
AND selected harness supports the authoring and execution path
```

Publish that effective capability in inspect/catalog metadata, with a default of unsupported for
older backends. The control should fail closed while metadata is missing.

## Internal MCP visibility

`agenta-tools` is synthesized by the runner and is absent from the saved template. It must remain
absent from authoring, saved diffs, counts, status rows, and discovered external-server tools.
Internal transport failures belong in run diagnostics, not in the external MCP editor.

## The reported enabled-Claude failure

Prior inspection found other active development services with the flag disabled. The user has
now identified a live deployment where MCP was enabled and still did not reach Claude. These are
not contradictory until the exact deployment and run are matched.

The failure can occur at five distinct seams:

1. the editor did not save `agent.mcps` into the invoked revision;
2. the selected deployment process did not receive the enablement flag;
3. the service did not emit `mcpServers` in `/run`;
4. the runner did not place the server in `sessionInit.mcpServers`;
5. Claude attempted asynchronous connection and failed, while status was discarded.

The first live work item is evidence capture across these seams. The model saying it has no tools
is not diagnostic evidence.

## Secret boundary

Today the saved template contains secret names, but resolution converts them to plaintext before
the `/run` boundary. For HTTP, the runner treats the values as headers. Plaintext therefore exists
in service memory, the wire request, runner memory, ACP configuration, and the Claude process.

Daytona opaque egress placeholders can improve the interim direct-Claude path, but they do not
provide one architecture for local and Daytona. The long-run boundary is the MCP gateway: it owns
upstream credentials and projects filtered tools onto the common Agenta tool plane.

## Stage score

| Layer | Current | Exit target for this project |
| --- | ---: | ---: |
| Public author config | 2/5 | 4/5 |
| Editor | 1/5 | 4/5 |
| Claude remote HTTP, no secrets | 2/5 | 4/5 |
| Claude diagnostics | 0/5 | 4/5 |
| Tool policy enforcement | 0/5 | 4/5 |
| Pi user MCP | 0/5 | 1/5, clean gateway seam only |
| Credential safety | 1/5 | 2/5, safe author contract and explicit runtime debt |
| Gateway readiness | 1/5 | 3/5, stable adapter boundary |

