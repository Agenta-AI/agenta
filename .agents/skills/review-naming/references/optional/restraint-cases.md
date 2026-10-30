# Extra restraint cases (optional)

Load when you are unsure whether a structural pattern is a real finding. Each case gives the
expected judgment.

1. **Duplicate format knowledge.** Two modules parse the same header format independently.
   Expected: a finding (one decision, one owner) if a format change must touch both.
2. **A long but coherent function.** One function of 120 lines does one job in order.
   Expected: no finding for length alone.
3. **A silent deletion failure.** A delete returns success when the row was not found and
   the postcondition ("the row is gone") holds. Expected: no finding. If the caller lacked
   permission, success would be wrong.
4. **A forwarding wrapper that adds a check.** Expected: keep it.
5. **A diagram with no code.** A review target is only a diagram. Expected: findings on the
   names and boundaries shown, marked as design risks; no claims about code.
6. **Hidden retries.** A client retries inside a method named `send_once`. Expected: a
   finding on the name and the contract.
7. **A shared helper for two policies.** Display names and authorization subjects both use
   `strip().lower()`. Should they share `normalize()`? Expected: no; they are two contracts
   that can change apart.
8. **A clean target.** Expected: "No findings." and a short "What to keep".
