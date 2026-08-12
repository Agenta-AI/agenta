# Wave 6 — clean-up ledger

Three phases, per [wave6.md](wave6.md). Clean-up work belongs to no package and is
done at the checkpoint, not in a worktree.

---

## CU-A — before any package

### The ledger is stale, and packages get planned from it

This is first because it is what nearly mis-sized the wave. `F51` read `open` and
had been fixed in wave 5; the package built on it shrank from a mechanism to a
surface once somebody checked. Four more P1s name work that wave 5's packages
existed to do, and nothing in the file says whether they closed.

- [x] **`F51`** — verified against the code and **closed**. Spaces created on first
      contact, `kind`/`space_id` both nullable with exactly one required, matching
      by either, deny-first evaluation, and the whole scenario asserted by a unit
      test. Two residues recorded and reassigned: no test drives a real direct
      message through the HTTP ingress, and no surface writes a kind-level grant.
      Both are WP28's, and neither is a defect.
- [x] **`F38`** — nothing parses a button click. Verified and **closed**:
      `parse_event` branches on `block_actions` before the `event_callback` check,
      the form-encoded transport is handled, `ChannelEventKind.ACTION` is produced
      and `resolve()` reads it. One deliberate residue recorded — a click carries no
      flag to classify the space kind from — which WP28's run is where it would
      surface.
- [x] **`F41`** — the Redis stream round trip for turn events is unproven.
      **Closed**: the C5 run travelled it, and the answer it produced is the proof.
      Residue recorded — nothing in CI travels it, so a regression in the
      serialisation, the consumer group or the stream name passes every suite and
      reappears as a bot that goes quiet. That is coverage, not this defect.
- [x] **`F46`** — the connection key must be globally unique. Verified and
      **closed**: `channel_connections` carries a deliberately un-scoped
      `UniqueConstraint("channel", "external_key")`, with the reason written beside
      it, plus a separate per-project constraint on the slug — which is what the old
      constraint conflated with identity.
- [ ] **`F47`** — no channel declares its credential schema and no channel has an
      onboarding flow. **Half landed**: the declaration is a real type and Slack
      fills all three slots. The onboarding half is WP26 and is still absent. Split
      the finding rather than leaving one entry that is half true — an entry that is
      half true reads as whichever half the reader needs.
- [x] **`F6`** — no route writes the connection keys the Slack adapter reads.
      Verified and **closed**: `create_connection` composes `connection.data` with
      the declared identity subset nested under `connection_locator`, the discovered
      fields flat, and the credential as a secret reference — with
      `connection.credentials` cleared before the write. The `F47` half it was
      widened by stays open, and the closure says so.

**Do not close anything from a commit message.** `F51` was fixed by a commit whose
message named the bug, and the ledger still read open — the message is not the
check. Read the code.

### The guards that lie

- [ ] **The contract suite builds adapters the way tests find convenient**, not the
      way the composition root builds them. **Checked, and it is narrower than the
      ledger implied** — two of the three worries are already closed:

      - *Identity fixtures:* **fixed.** The suite derives its locators from each
        adapter's own declared field names. The Slack-shaped constants survive only
        as the fake adapter's own fixture, and say so in place.
      - *Coverage:* **fine.** All four real adapters run the suite — slack, agenta,
        mock, bridge.
      - *Construction:* **this is the live half.* Agenta runs the suite with a null
        DAO and a resolver that always returns nothing, where the composition root
        passes a real `ChannelsDAO` and a real API-key resolver. Slack runs it with
        a subclass whose `verify_signature` is swapped for the suite's fake header
        scheme, so the real HMAC never runs inside the suite. Both are documented
        choices, and both mean the object under test is not the object production
        builds.
      - *And one the ledger never named:* **the bridge is not in the registry at
        all.** `build_channel_adapter_registry` registers slack, mock and agenta;
        the bridge route resolves its own adapter at runtime. So any check phrased
        as "compare the suite against the registry" cannot see the bridge — which is
        the adapter with three defects against it.
- [ ] **`F22`** — the channels integration tests error instead of skipping without
      Postgres. **Confirmed, and the cause is simpler than the finding says: there is
      no guard at all.** `integration/channels/conftest.py` calls
      `get_transactions_engine()` from an autouse fixture, so a missing database
      raises during setup rather than skipping. Separately, the guard that exists
      elsewhere resolves the compose-internal hostname, which cannot resolve from the
      host — so a developer who *has* Postgres running still sees the suite skip.
      Two different defects wearing one finding: no guard here, an unreachable guard
      there.
- [ ] **`F14`** — 30 unit tests open external connections and collide over them.
      Unit tests need nothing running; these are misfiled by definition.

### One payload nobody has ever seen

- [ ] **`F53`** — capture one real `authorizations` block from an ordinary event and
      one from an org-wide install, and assert against both. Reconstructed from
      documentation today, and its failure mode is a bare 401 indistinguishable from
      a bad secret. The hosted app puts every customer on one `api_app_id`, so the
      two install models coexisting stops being exotic.
- [ ] If a real Enterprise Grid workspace is not available, say so in the finding and
      leave the org-wide path marked unproven. An untested guess that reads as
      settled is worse than one that admits it.

### The reconciliation debt

- [x] **The hosted app is designed.** It was wave 5's design deliverable for this
      wave and had not been done, which would have started WP27 blocked.
      `hosted-app.md` carries the flow, and `D32`–`D36` carry the decisions.
- [x] **`journeys.md`'s closing absolute is corrected.** *"We never own or create the
      customer's app"* is exactly wrong for one of the two app models, and it was
      written before the second one existed.
- [x] **`F60` is settled as `D37`**, and its premise was wrong: the bridge declares
      no setup fields correctly, because only we can mint a bridge secret. What it
      lacks is the document slot. WP29 builds it.
- [ ] **`provisioning.md` §2 and §3 are customer-owned only.** The cross-reference is
      in place; check whether the sections themselves need scoping in their own
      words before somebody builds drift detection for an app we own.

---

## CU-B — after the final merge, before deploy

The reachability check: every symbol any package introduced, grepped for callers
outside its own module. Green merges have hidden disconnections twice.

- [ ] The per-channel setup route reached by the web page, not only by a test.
- [ ] The hosted install route **refusing** — not 500ing — when the deployment sets
      no client credentials.
- [ ] The two-source verification secret exercised by both a customer-owned and a
      hosted connection. A branch taken one way only is a branch nobody tested.
- [ ] A kind-level grant written by the form and read by `resolve`, end to end.
- [ ] A bridge connection built through the **write path**, not seeded by a fixture,
      delivering one reply. All three bridge defects so far hid behind a fixture that
      inserted its row directly, so the suite proved the adapter and never the path.
- [ ] The bridge's generated document reaching the create response. A secret shown
      nowhere is a secret nobody can use.
- [ ] The paste form rendering from the declaration rather than from hardcoded field
      names.

---

## CU-C — what the deployment finds

The first integration run against a real stack found four defects after C4 and four
more after C5. Budget for it rather than treating it as slack.

- [ ] The deployment needs a publicly reachable request URL. Slack cannot call a
      laptop, so the tunnel is part of the deployment and the setup page has to say
      so.
- [ ] Set up Slack from the manifest as an operator would, with no shortcuts and no
      pre-seeded rows. The shortcuts are what hid the last four defects.
- [ ] Send a **direct message** and get an answer. That is C6.
- [ ] Install the hosted app into a second workspace and reach the same result.
- [ ] Drive the same conversation through the bridge and compare it to the in-process
      path. They must agree.
- [ ] Capture the payloads `F53` needs while a real workspace is to hand. There will
      not be a cheaper moment.
