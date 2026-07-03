---
id: reference-only
code: REF-5
title: Reference-only invocation doesn't load the committed config — what this means
status: waiting
needs_reply: false
promoted_to: ''
created: '2026-07-01T13:54:47Z'
updated: '2026-07-01T18:23:49Z'
---



















# Reference-only invocation doesn't load the committed config — what this means

## Summary

**Settled: not a product bug.** invoke-validation is implemented on #5002 and awaiting review. The reference behavior itself is closed; #5002 covers the validation gap instead.

## Messages


**Agent** · Jul 1, 13:54

User: 'reference-only invocation never loads the committed config; only inlining worked' — I don't understand this point.

**Agent** · Jul 1, 13:57

When you run an agent, the invoke call can name the agent two ways.

- **By reference:** send only the app id. The service should look up that app's saved (committed) config and run it.
- **Inline:** send the whole config in the request body on every call.

On this deployment, the by-reference way does not work. If you send only the app id, the service ignores the saved config and runs a generic default agent instead (`gpt-5.5` / `pi_core`), not the agent you committed. The only way to actually run your agent is to resend its full config inline on every single call.

Analogy: you save a document, but every time you open it by its name you get a blank template. The only way to see your real document is to paste its full text in each time.

Why it matters: the playground and any real caller then have to carry and resend the entire config on every message. Pointing at "the committed agent" by id silently gives you the wrong agent, with no error. That is fragile and surprising. The `invoke-service` subagent is finding out whether this is a bug or an unfinished code path, and how the completion and chat services handle the same thing.

**Agent** · Jul 1, 14:08

The why is now clear: this is a **bug**, not by design, and the fix is small.

The agent workflow seeds a **default config** into the SDK config registry: `agent=dict(v0=WorkflowRevisionData(parameters={"agent": build_agent_v0_default()}))` (`sdks/python/agenta/sdk/engines/running/utils.py:285-287`). Chat and completion seed an **empty** `WorkflowRevisionData()` instead.

That non-empty seed flips off the resolver's reference-hydration gate (`needs_reference_hydration`, `resolver.py:572-577`). So when you invoke by reference only, the service **skips** fetching your committed revision (`POST /applications/revisions/retrieve`) and runs the seeded default (`pi_core` / `gpt-5.5`). Chat and completion resolve references correctly precisely because they seed empty.

**Fix:** drop the `parameters` from the agent seed so it matches chat and completion. The handler already fills defaults from empty params, and `/inspect` still advertises the default schema. This is the single highest-value fix here: it removes the "inline the full config on every call" requirement entirely, so callers can point at a committed agent by id and actually get it.

**Agent** · Jul 1, 14:47

Good pushback. Let us align before touching anything.

Plain terms: "hydration" just means the service fetching your committed config for the reference you passed and filling it into the run. Nothing fancier.

Your model is right, and we actually agree on the definition. You invoke an agent two ways: (1) run with the full config inline while you are editing or testing, no commit, exactly like the template does; or (2) commit, get the revision id and variant id back, then invoke by that reference. The only open question is case (2): when you invoke by a committed reference with NO inline params, does the service run your committed config or the default agent? My lab test saw the default. You said that exact thing would be a bug ("running the default even if you committed a revision"). So we are aligned on the definition; we only need to confirm the behavior is real and find where it bites.

Where does this invocation happen (your question): that is the crux, so I am checking it. The two places that matter are the playground run and a trigger or schedule firing. If a schedule fires by reference and the service falls back to the default, then every scheduled agent runs the wrong config. That would be the real-world impact, and it is exactly what I want to confirm before calling it a bug.

Plan: (1) I re-test live now — commit an agent, invoke it by revision id and by app id with no inline params, and read the trace's resolved config. (2) A subagent maps where the product actually invokes by reference (playground, triggers, schedules) and confirms the code path. Then I report back: is it a real bug, and is the right fix code (make a reference load the committed config) or a doc/skill instruction (tell the user and the agent how to invoke correctly), or both with a clear warning. Keeping this decision open until we agree.

**Agent** · Jul 1, 14:52

Live re-test (me, direct): I invoked the committed uc1-summarizer agent (committed config = claude/sonnet) by all three reference kinds with NO inline params: (1) application.id, (2) application_variant.id, (3) application_revision.id. All three resolved to the DEFAULT pi_core/gpt-5.5 in the trace, not the committed claude/sonnet, and all three returned HTTP 500 (the default likely 500s because gpt-5.5 has no working key here). So pointing at a committed agent by reference does not run it — it runs the default and errors. This matches exactly the behavior you called a bug. ONE caveat before I call it definitively a code bug: I want to confirm I used the correct reference KEYS. If the service expects a different reference shape than application/application_variant/application_revision, it would ignore mine and fall to the default for that reason instead. The invoke-research subagent is reading the exact reference-resolution code AND checking whether a schedule fires by reference (if so, every scheduled agent would 500 the same way — the real-world impact). I will lock the bug-or-not verdict once that lands.

**Agent** · Jul 1, 15:02

Corrected verdict: this is NOT a production bug, and your pushback was right.

What actually happens across the real callers:
- Playground (agent chat) always sends the full config inline, so it runs your committed/edited config.
- Triggers and schedules fire by reference only, BUT every invoke goes through the API's `_ensure_request_revision` (`api/oss/src/core/workflows/service.py`), which fetches the committed revision server-side and writes it into `request.data.revision` before forwarding to the agent service. The SDK resolver reads `data.revision` before the seeded default, so the committed config runs. So a scheduled agent does NOT run the wrong config. My earlier investigation missed this API-side hydration layer.
- The ONLY path that falls back to the default (pi_core/gpt-5.5) is a direct reference-only call to the low-level agent service endpoint that bypasses the API. That is exactly what my lab test did (I called {host}/services/agent/v0/invoke directly with references and no params). That is not how the product invokes.

So your model was correct: inline while editing, or commit and invoke by reference, and it works. I was testing the wrong door.

There is one real but latent inconsistency worth knowing: the agent is the only builtin workflow whose registry seeds a non-empty default config, and that non-empty seed disables the SDK's own reference-hydration net. Completion and chat seed empty, so if THEY are called reference-only at the service level they hydrate correctly; the agent does not. It has no production impact today (nothing calls the agent service reference-only), but if we ever want the agent service to behave like completion/chat for a direct reference call, the fix is one line: seed the agent registry empty like the others. Low priority, your call.

Kit correction: I am fixing my playbook and verified-facts, which wrongly called reference-only a universal "silent fallback bug". For the lab it still inlines, because the lab calls the service endpoint directly, but that is a lab artifact, not a product truth.

**You** · Jul 1, 15:02

ok something is off. here. can you give me the curl command you tried here is what I tried

Last login: Tue Jun 30 23:12:49 on ttys009
mahmoudmabrouk@Mac ~ % curl -X POST "https://bighetzner.agenta.dev/api/applications/revisions/retrieve" \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey <REDACTED-PROJECT-API-KEY>" \
  -d '{
    "application_ref": {
      "slug": "uc1-summarizer"
    },
    "application_variant_ref": {
      "slug": "21d7faff16a6"
    },
    "application_revision_ref": {
      "version": "1"
    }
  }'

{"count":1,"application_revision":{"application_variant_slug":"21d7faff16a6","workflow_variant_slug":"21d7faff16a6","application_slug":"uc1-summarizer","workflow_slug":"uc1-summarizer","application_variant_id":"019f1a7b-c448-7c50-a90c-03731450a9a9","workflow_variant_id":"019f1a7b-c448-7c50-a90c-03731450a9a9","application_id":"019f1a7b-c42d-7d42-a878-95fe4651150b","workflow_id":"019f1a7b-c42d-7d42-a878-95fe4651150b","variant_slug":"21d7faff16a6","artifact_slug":"uc1-summarizer","variant_id":"019f1a7b-c448-7c50-a90c-03731450a9a9","artifact_id":"019f1a7b-c42d-7d42-a878-95fe4651150b","author":"019f1867-7ba5-7de0-bc3e-3364ee17beea","date":"2026-06-30T21:42:26.682979Z","flags":{"is_application":true,"is_evaluator":false,"is_snippet":false,"is_managed":true,"is_custom":false,"is_llm":false,"is_hook":false,"is_code":false,"is_match":false,"is_feedback":false,"is_agent":true,"is_skill":false,"is_chat":false,"has_url":true,"has_script":false,"has_handler":false,"is_static":false},"name":"uc1-summarizer","created_at":"2026-06-30T21:42:26.682986Z","created_by_id":"019f1867-7ba5-7de0-bc3e-3364ee17beea","version":"1","slumahmoudmabrouk@Mac ~ %


weirdly the ui shows the right config. 


If I commit a sercond versino of this in the ui and then fetch it it workds

curl -X POST "https://bighetzner.agenta.dev/api/applications/revisions/retrieve" \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey <REDACTED-PROJECT-API-KEY>" \
  -d '{
    "application_ref": {
      "slug": "uc1-summarizer"
    },
    "application_variant_ref": {
      "slug": "21d7faff16a6"
    },
    "application_revision_ref": {
      "version": "2"
    }
  }'

{"count":1,"application_revision":{"application_variant_slug":"21d7faff16a6","workflow_variant_slug":"21d7faff16a6","application_slug":"uc1-summarizer","workflow_slug":"uc1-summarizer","application_variant_id":"019f1a7b-c448-7c50-a90c-03731450a9a9","workflow_variant_id":"019f1a7b-c448-7c50-a90c-03731450a9a9","application_id":"019f1a7b-c42d-7d42-a878-95fe4651150b","workflow_id":"019f1a7b-c42d-7d42-a878-95fe4651150b","variant_slug":"21d7faff16a6","artifact_slug":"uc1-summarizer","variant_id":"019f1a7b-c448-7c50-a90c-03731450a9a9","artifact_id":"019f1a7b-c42d-7d42-a878-95fe4651150b","author":"019f1867-7ba5-7de0-bc3e-3364ee17beea","date":"2026-07-01T15:00:58.753153Z","flags":{"is_application":true,"is_evaluator":false,"is_snippet":false,"is_managed":true,"is_custom":false,"is_llm":false,"is_hook":false,"is_code":false,"is_match":false,"is_feedback":false,"is_agent":true,"is_skill":false,"is_chat":true,"has_url":true,"has_script":false,"has_handler":false,"is_static":false},"name":"uc1-summarizer","created_at":"2026-07-01T15:00:58.753157Z","created_by_id":"019f1867-7ba5-7de0-bc3e-3364ee17beea","version":"2","slug":"c3688e3de42a","id":"019f1e32-9301-7aa1-8b62-28b72b9e8b06","data":{"uri":"agenta:builtin:agent:v0","url":"https://bighetzner.agenta.dev/services/agent/v0","schemas":{"parameters":{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"agent":{"x-ag-type-ref":"agent-template","type":"object","description":"The agent's instructions, model, tools, MCP servers, and runtime.","default":{"instructions":{"agents_md":"You are a friendly hello-world agent running on the Agenta agent service.\n\n- Greet the user warmly.\n- Answer the user's message in one or two short sentences."},"llm":{"model":"gpt-5.5"},"tools":[],"mcps":[],"harness":{"kind":"pi_core"},"runner":{"kind":"sidecar","interactions":{"headless":"auto"}},"sandbox":{"kind":"local"}}}},"additionalProperties":true},"inputs":{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":true,"properties":{"messages":{"x-ag-type-ref":"messages","type":"array","description":"Ordered list of normalized chat messages."}}},"outputs":{"$schema":"https://json-schema.org/draft/2020-12/schema","x-ag-type-ref":"message","type":"object","description":"Final assistant message returned by the agent."}},"parameters":{"agent":{"instructions":{"agents_md":"You are a text summarizer. The user gives you a block of text. Produce a clear, faithful summary of it. Capture the main points and key details, drop filler, and keep the original meaning. Do not add opinions or information that is not in the source. Default to a short paragraph; if the text is long or has several distinct points, use a few concise bullet points. Match the language of the input.w"},"llm":{"model":"sonnet","provider":"anthropic","connection":{"mode":"self_managed"}},"tools":[],"mcps":[],"skills":[],"harness":{"kind":"claude"},"runner":{"kind":"sidecar","interactions":{"headless":"auto"}},"sandbox":{"kind":"local"}}}}},"retrieval_info":{"references":{"application":{"slug":"uc1-summarizer","id":"019f1a7b-c42d-7d42-a878-95fe4651150b"},"application_variant":{"slug":"21d7faff16a6","id":"019f1a7b-c448-7c50-a90c-03731450a9a9"},"application_revision":{"version":"2","slug":"c3688e3de42a","id":"019f1e32-9301-7aa1-8b62-28b72b9e8b06"}}}}%


so the issue it seems in the first version. I know that the first version is just the one created by the UI when createing the app (since it neeeds to create a first commit). I am surprised you expect it to be claude and not gpt 5. It seems no new revision has eben committed as expected. Or was it that the first revision was committed with the wrong paramters

**Agent** · Jul 1, 15:21

Here is the exact command I ran, and a fresh run of it just now.

```
curl -sS -X POST "$AGENTA_HOST/services/agent/v0/invoke" \
  -H "Authorization: ApiKey $AGENTA_API_KEY" -H "Content-Type: application/json" \
  -d '{"data":{"inputs":{"messages":[{"role":"user","content":"Summarize: The cat sat."}]}},
       "references":{"application":{"id":"019f1a7b-c42d-7d42-a878-95fe4651150b"}}}'
```

Response now: `500 model 'gpt-5.5' needs a provider prefix ...`. That error is the tell: the run used the DEFAULT config (gpt-5.5), not the committed claude/sonnet. So the reference was not hydrated.

Reconciling with what you tried: I hit the low-level AGENT SERVICE endpoint `/services/agent/v0/invoke` directly. That endpoint does not hydrate a reference. Your curl hit `/api/applications/revisions/retrieve`, which is the RETRIEVE endpoint — a piece of the hydration, and it works fine on its own. The product never calls the service endpoint reference-only: the API-mediated invoke path calls retrieve (`_ensure_request_revision`) to load the committed revision into `data.revision`, then forwards that to the service. So through the API a reference runs your committed config; only my direct-to-service call falls back.

So we are aligned: not a product bug. My lab used the wrong door (the raw service endpoint, because it is the simplest thing to curl). Two things I can do if useful: (1) give you the exact API-mediated invoke curl that hydrates a reference, so you can watch the committed config run by reference; (2) as noted, there is a one-line consistency nicety (seed the agent registry empty like completion/chat) so even the raw service endpoint would hydrate — low priority, your call.

**You** · Jul 1, 15:26

I'm very confused by your response. My assumption is that calling `invoke` is the same as calling `retrieve`, so I don't know exactly what you are saying. If you were to call the second revision that I've created with the same parameters, but with `invoke`, it would not work. Is there a bug? Please think about this with context and explain it simply.

**Agent** · Jul 1, 15:37

I have to correct myself. I tried to prove the hydrated path works by replicating what the API does: retrieved the committed revision, then invoked WITH data.revision populated (the revision that has claude/sonnet). It STILL ran the default gpt-5.5 and 500'd. So my earlier 'not a bug, the API hydrates it' claim is NOT verified — my own replication failed. I will not guess again. A subagent is settling it with a live-proof requirement: the exact payload that makes the service run the committed config by reference, or a clear statement that only inline works, plus whether the real product path actually loads it. You will get a definitive yes/no with the working curl.

**Agent** · Jul 1, 15:44

Settled, with live proof, and it turns out my failed tests were a payload-shape error on my side.

The working invoke that runs your committed config (proven live: RESOLVED = harness=claude, model=sonnet, 200, trace cffc952469f05806637356aff0c8ec71): send the revision DOUBLE-nested.

```
data.revision = { "data": <application_revision.data> }
```

where `<application_revision.data>` is exactly what `POST /api/applications/revisions/retrieve` returns.

Why my earlier attempts failed:
- Attempt 1 sent references only (no revision). The service does NOT self-hydrate a bare reference, so it ran the seeded default (gpt-5.5) and 500'd.
- Attempt 2 sent `data.revision = <revision.data>` SINGLE-nested. The resolver reads `data.revision["data"]` (`resolver.py:150`), so a single-nested dump has no inner `data` key and is skipped, falling through to the default again. I had the nesting one level off.

Verdict, per path:
- **Product (playground, triggers, HITL): NOT a bug.** The API's `_ensure_request_revision` pre-hydrates the reference into the double-nested `data.revision` before forwarding, so your committed config runs. Every product caller does this. Proven live.
- **Raw reference-only call directly to the service endpoint: a real gap.** The service does not hydrate a bare reference itself; it relies on the API to pre-hydrate. A references-only POST to `/services/agent/v0/invoke` runs the default. Low priority (no product caller does this), but if we want the service to self-hydrate a bare reference like completion and chat do, that is the one-line "seed the agent registry empty" fix.
- **My earlier "not a bug": half right.** Production is fine, but my stated mechanism was wrong, and the real reason my replication failed was double-vs-single nesting. Sorry for the churn.

So your instinct was right: invoke by a committed reference DOES run your committed config in the product. Full detail + all three trace ids in findings/reference-invoke-definitive.md.

**You** · Jul 1, 16:09

Can you spin off a sub-agent that creates a draft PR that explains the bug and then proposes the following solution?
For the second issue, it looks like there is an issue with validation. If the way you send the data was wrong, you should have gotten an error. I would even argue it’s the same for the first one. Both should have told you not to do it this way and that the right way to call an application is through one of the following:
- Providing the revision correctly (which is kind of a complete revision)
- Not providing a revision
- Providing configuration instead uh, this is 


I don't understand this problem of self-hydration. I think it's a problem from the perspective of validation, right? I need to validate that the request calling `invoke` asks for the right thing and provides a complete revision.

That means it is not just an application. It has to be at least a variant or an environment that you can resolve from, but we currently just have an application, and I don't think that works. I'm not sure, but I think the one thing we need to validate is that if you are sending some revision, you need to make sure it's nested in the right way.

Let's have a draft PR that solves this and also updates the sub-agent instructions so they include how this call should be made.

**Agent** · Jul 1, 16:59

On it. A subagent is writing a design-doc-only PR that reframes this as validation: a malformed invoke should return a clear error naming the valid call shapes (complete nested revision / no revision / inline config), require a resolvable reference (variant/env/revision, not bare application), and validate revision nesting. It also updates the kit's BUILD-AGENT.md with the correct call shape.

**Agent** · Jul 1, 17:09

Design PR is up: https://github.com/Agenta-AI/agenta/pull/5002 (design docs only, needs-review). It reframes this exactly as you did — a validation problem. The proposal: validate the invoke request and return a clear 4xx naming the three valid ways to call: (1) a complete revision, correctly double-nested; (2) no revision plus a RESOLVABLE reference (a variant, environment, or revision — NOT a bare application, which pins nothing); (3) inline data.parameters. Three rules: a supplied revision must be double-nested; a reference target must resolve (extends the existing family validator); reject with the shapes spelled out if none is present. It also updated the kit BUILD-AGENT.md so a subagent calls invoke the right way. Review on the PR.

**Agent** · Jul 1, 18:03

Implemented on #5002 (label implementing). resolver-only change: an invoke must resolve to a config via inline data.parameters OR a revision (double-nested, or a resolvable variant/env/revision reference). A present-but-single-nested data.revision, or a bare application reference that pins nothing, now returns a clear 400 naming the two valid shapes. Empty body is left alone (no completion/chat regression). No self-hydration bundle (separate follow-up). Tests: 41/41 resolver + 489/489 agents, ruff clean. Review on #5002.
