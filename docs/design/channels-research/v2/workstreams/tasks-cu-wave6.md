# Wave 6 — clean-up ledger

Three phases, per [wave6.md](wave6.md). Clean-up work belongs to no package and is
done at the checkpoint, not in a worktree.

**What CU-A found, now that it has run.** Three more entries in this file were wrong
about their own subject, on top of the six the wave already knew about: `F22` claimed
a guard that exists does not, `F14` counted 30 misfiled tests where there is one, and
the contract-suite entry treated the bridge's absence from the registry as a coverage
gap. It is a P0 — the bridge route resolves through that registry, so it answered 404
for every request, and every suite passed because every suite builds its own registry.

The pattern is one pattern. **A record of a defect is not the defect**, and a check
that constructs its own subject checks nothing. Nine of this file's entries have now
been decided by reading the code instead, and the one that mattered most was the one
nobody had filed.

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
- [x] **`F47`** — split, and the halves now disagree in the record rather than inside
      one entry. The declaration half is **closed**: `ChannelCapabilities.setup` is a
      real type, Slack fills all three slots, and a unit test asserts both a channel
      that declares everything and one that declares nothing. The onboarding half is
      **`F65`**, open, WP26's. The evidence for the split is blunt — the connections
      section says in its own comment that it never builds a create form, and links
      to an unrelated tab instead.
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

- [x] **The contract suite builds adapters the way tests find convenient**, not the
      way the composition root builds them. **Fixed, and the fourth worry turned out
      to be a P0 in production.** Two of the three original worries were already
      closed:

      - *Identity fixtures:* **fixed.** The suite derives its locators from each
        adapter's own declared field names. The Slack-shaped constants survive only
        as the fake adapter's own fixture, and say so in place.
      - *Coverage:* **fine.** All four real adapters run the suite — slack, agenta,
        mock, bridge.
      - *Construction:* **was the live half, now fixed.** Agenta ran the suite with a
        null DAO and a resolver returning nothing — and with `verify_signature`
        swapped out on top, which made the resolver dead code whatever it returned.
        It now runs against a DAO-shaped fake and a resolver that really resolves,
        with the real API-key check deciding accept or reject. Slack ran with
        `verify_signature` replaced by the suite's fake header scheme, so the real
        HMAC never ran; the suite now signs its fixture body with the fixture
        connection's own secret and calls the production method unmodified.
      - *And one the ledger never named:* **the bridge was not in the registry at
        all** — and the consequence is worse than a coverage gap. The bridge ingress
        route resolves its adapter through that same registry, and the registry
        raises on a miss, so `POST /bridge/events/` answered 404 for every request in
        every composition root. The outbox worker resolves the same way, so a bridge
        connection could neither receive an event nor deliver a reply. Filed and
        closed as **`F66`**; `BridgeAdapter()` is registered beside the other three.
      - *Why every suite stayed green:* each bridge test builds its own registry with
        the bridge in it. No test ever asked the question the composition root
        answers. A guard now fails when a channel has a contract suite but neither a
        registration nor a written exemption.
      - *Worth keeping:* the factory's own comment said the bridge was missing. It was
        known, recorded beside the code, and shipped, because nothing executable
        disagreed with it.
- [x] **`F22`** — **this entry was wrong on both halves, and the guard works.** A
      layer-wide autouse guard exists at `integration/conftest.py`; the channels
      conftest reaches the engine from `channels_scope`, which is not autouse. Order
      was checked with `--setup-show` rather than assumed, since a parent conftest
      racing a child's async autouse fixture is how this would fail quietly: the
      guard runs first, and when it skips the channels fixtures never appear at all.
      Probe pointed at a dead port, the suite gives **58 skipped, 0 errors**.

      The residue is real and is the interesting half: **a skip that reads as a
      pass.** The probe resolves the compose-internal hostname, so somebody with a
      healthy database who runs bare `pytest` sees the whole layer skip and calls it
      green. Not fixed by guessing a better host — probe and engine derive from one
      setting, and pointing the probe somewhere the engine will not follow was tested
      and converts the clean skip into `InvalidCatalogNameError`. The skip message now
      names the host and port it tried and which variable to export, which `-ra`
      prints on every run. The decision itself is untouched.
- [x] **`F14`** — **one file, not 30.** The 30 was a string match that could not tell
      a dependency from a fake of one. Re-run it gives 33 hits and nearly all are
      `_FakeRedis`, `_FakeTransactionsEngine`, `_FakeObjectStore`, a `redis_client=None`
      keyword, or a monkeypatched engine getter; `sessions/` supplies 25 of them and
      every one is deliberate. Exactly one file calls an unpatched
      `get_transactions_engine()`, it is marked `integration`, and it self-guards, so
      it skips rather than errors. It is misfiled by directory and belongs to another
      area. Measured, not argued: the unit layer runs green with nothing reachable —
      2982 passed, 8 skipped, 0 errors. Channels contributes no violation.

### One payload nobody has ever seen

- [ ] **`F53`** — capture one real `authorizations` block from an ordinary event and
      one from an org-wide install, and assert against both. **Carried to CU-C**: no
      Enterprise Grid workspace is available before the deployment, and there will not
      be a cheaper moment than one with a real workspace to hand.
- [x] No Enterprise Grid workspace is available, and the record says so. The finding
      states plainly that the org-wide path is unproven and stays unproven, and the
      discriminator in the Slack adapter now carries the same admission in one line —
      the field positions come from documentation, and a wrong guess fails as a bare
      401 that nothing reports.

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
- [x] **`provisioning.md` §2 and §3 are customer-owned only**, and now say so in their
      own words. §2's generate-and-compare drift flow does not apply to one manifest
      we maintain for everybody. §3's principle holds for both models, but its shape
      does not: there is no paste step in a hosted install, so verification happens
      inside the token exchange rather than as an operator action.

      Found while there: the document's own opening and §1 still claimed nothing
      declares a credential schema and the manifest builder has no callers. Both
      closed while the document stood still, so it read as a list of missing work.
      Corrected — it now says which third of the gap survives.

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
