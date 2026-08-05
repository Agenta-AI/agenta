# risks.md – Systemic Risks

| ID | Category | Description | Likelihood | Impact | Evidence | Mitigation | Status |
|---|---|---|---|---|---|---|---|
| R-001 | Architecture | Gateway resolution formerly carried approval/render metadata by response position. | Low | Medium | `services/oss/src/agent/tools/gateway.py` | Resolved specs are now matched to configs by normalized `call_ref`; a reversed-response integration test pins the behavior. | mitigated |

## Notes

- No open architecture risk remains from this review.
