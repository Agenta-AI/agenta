# Open questions

None of these blocks slice 1. Question 1 should be answered before flipping the Daytona
flag on by default.

1. **Daytona held-exec limits.** The design holds one bounded (25 s) `runProcess` request
   per active turn. In-repo evidence says long-held requests through the preview proxy
   work (ACP approval pauses hold for minutes to hours), but Daytona's documented limits
   on concurrent execs per sandbox and per organization, and any proxy idle timeout, are
   unverified. Who confirms with Daytona, and does the answer move the 25 s window
   default?
2. **Default-on timing for the Daytona watch.** Flip `AGENTA_AGENT_TOOLS_RELAY_WATCH` to
   `true` right after the QA pass, or keep it opt-in until the Claude MCP shim (the
   second relay writer) lands so both writers are QA'd on the same fast path?
3. **Backstop cadence follow-up.** Once the watch is trusted, is it worth raising the
   idle backoff cap (1.5 s today) to cut Daytona fallback polling further, for example to
   5 s or 30 s? Plan.md defers this deliberately (decision 4); this question is about
   whether the follow-up is wanted at all, and at what value.
4. **Permanent timing log.** Keep the `stage=relay_pickup` per-call latency log after QA,
   or remove it once the numbers are recorded?
5. **Custom snapshots without node.** The watch exec needs node in the sandbox image. The
   default snapshot has it (Pi runs on node). Is degrade-to-poll acceptable for custom
   snapshots without node, or should the script have a shell-only variant
   (`inotifywait` is not guaranteed either, so a portable shell variant may not exist)?
6. **Sequencing against the MCP shim revival (#4873).** Land this relay work first (the
   shim then inherits the fast path), or together with the shim revival in one review
   cycle?
