# Tasks

Checked items describe the existing implementation and prior focused checks at `c8e3cfd50359ddb4824a3972f0080ae6abd58318`. They do not claim full provider acceptance. See [status](../../status.md).

## 1. Existing implementation

- [x] 1.1 Carry discovery support flags into the probe and reject unsupported automatic registration. Verify the probe and registration fallback unit tests.
- [x] 1.2 Accept write-only manual client input on begin and persist connection-specific registrations. Verify model, router, storage, and service unit tests.
- [x] 1.3 Add the shared client form and token alternative. Verify the entity API and rendered journey tests.

## 2. Acceptance still required

- [ ] 2.1 Add adversarial storage tests for an endpoint with no manual registration while another endpoint at the same issuer has one. Verify no cross-endpoint client reuse; correct any failing behavior before acceptance.
- [ ] 2.2 Verify endpoint deletion removes its private client registration without deleting shared dynamic registrations. Add lifecycle tests and correct any orphaned registration behavior.
- [ ] 2.3 Test GitHub with a real registered application and HTTPS callback. Record consent, exchange, reconnect, applicable refresh, and a read-only MCP tool call at the exact tested commit.
- [ ] 2.4 Test Slack with an MCP-enabled application and approved user scopes over HTTPS. Record consent, exchange, reconnect, applicable refresh, and a read-only tool call.
- [ ] 2.5 Complete the real manual-token fallback for both providers with the correct Authorization header. Verify tool discovery, invalid-token feedback, and credential redaction.
- [ ] 2.6 Run acceptance fixtures in a configured environment and rerun focused regressions after any fixes. Record commands, counts, and exact commit; the earlier eight missing `ag_env` fixture errors are not a pass.
- [ ] 2.7 Obtain review approval, resolve remaining findings, and archive this change only after its acceptance evidence is complete. Verify main specs contain the accepted delta rather than future proposals.
