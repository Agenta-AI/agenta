import {describe, expect, it} from "vitest"

import {
    CALL_DESCRIPTION_MAX_LENGTH,
    canonicalToolName,
    extractCallDescription,
    partToolName,
    resolveToolDisplay,
} from "./toolDisplay"

// The agent's own note about a builder tool call (R12). It rides in the call's arguments, so the
// tool card reads it straight off `input` on both the live and the replay path.
describe("extractCallDescription", () => {
    it("reads the agent's note off the call input", () => {
        expect(
            extractCallDescription({
                description: "Adding the pdf-tools skill you asked for.",
                workflow_revision: {message: "Add the pdf-tools skill."},
            }),
        ).toEqual({text: "Adding the pdf-tools skill you asked for.", truncated: false})
    })

    it("returns null when the agent wrote no note", () => {
        expect(extractCallDescription({workflow_revision: {message: "m"}})).toBeNull()
    })

    it("treats a blank note as no note", () => {
        expect(extractCallDescription({description: "   "})).toBeNull()
        expect(extractCallDescription({description: ""})).toBeNull()
    })

    it("trims surrounding whitespace", () => {
        expect(extractCallDescription({description: "  why  "})?.text).toBe("why")
    })

    it("ignores a non-string description", () => {
        expect(extractCallDescription({description: 42})).toBeNull()
        expect(extractCallDescription({description: {nested: "no"}})).toBeNull()
        expect(extractCallDescription({description: null})).toBeNull()
    })

    it("survives inputs that are not objects", () => {
        expect(extractCallDescription(undefined)).toBeNull()
        expect(extractCallDescription(null)).toBeNull()
        expect(extractCallDescription("plain")).toBeNull()
        expect(extractCallDescription(["description"])).toBeNull()
    })

    it("cuts an over-long note and says it cut it", () => {
        const long = "a".repeat(CALL_DESCRIPTION_MAX_LENGTH + 50)
        const result = extractCallDescription({description: long})
        expect(result?.truncated).toBe(true)
        expect(result?.text).toHaveLength(CALL_DESCRIPTION_MAX_LENGTH)
    })

    it("does not mark a note at exactly the limit as cut", () => {
        const exact = "a".repeat(CALL_DESCRIPTION_MAX_LENGTH)
        expect(extractCallDescription({description: exact})).toEqual({
            text: exact,
            truncated: false,
        })
    })

    it("cuts on a code-point boundary when an emoji straddles the limit", () => {
        // The emoji is one code point but two UTF-16 units, so a `slice` at the cap would keep a
        // lone surrogate half and the card would render a replacement character.
        const description = `${"a".repeat(CALL_DESCRIPTION_MAX_LENGTH - 1)}\u{1F600}tail`
        const result = extractCallDescription({description})

        expect(result?.truncated).toBe(true)
        expect(result?.text.endsWith("\u{1F600}")).toBe(true)
        expect(result?.text).not.toContain("\uFFFD")
        // No unpaired surrogate survived the cut.
        expect(/[\uD800-\uDFFF]/.test(result!.text.replace(/\p{Emoji_Presentation}/gu, ""))).toBe(
            false,
        )
        expect(Array.from(result!.text)).toHaveLength(CALL_DESCRIPTION_MAX_LENGTH)
    })

    it("counts an all-emoji note in code points, matching the catalog cap", () => {
        // 400 emoji are 800 UTF-16 units: measured in units this would look over the limit and be
        // cut, when the model was well within what the catalog allowed it to send.
        const description = "\u{1F600}".repeat(400)
        const result = extractCallDescription({description})

        expect(result).toEqual({text: description, truncated: false})
    })
})

describe("partToolName", () => {
    it("strips the tool- prefix from a typed part", () => {
        expect(partToolName({type: "tool-commit_revision"} as never)).toBe("commit_revision")
    })

    it("reads toolName off a dynamic part", () => {
        expect(partToolName({type: "dynamic-tool", toolName: "test_run"} as never)).toBe("test_run")
    })
})

describe("canonicalToolName", () => {
    it("unwraps our own MCP server so both harnesses key the same", () => {
        expect(canonicalToolName("mcp__agenta-tools__commit_revision")).toBe("commit_revision")
        expect(canonicalToolName("commit_revision")).toBe("commit_revision")
    })

    it("unwraps the Codex dot form of the same server", () => {
        expect(canonicalToolName("mcp.agenta-tools.commit_revision")).toBe("commit_revision")
    })

    it("leaves another server's tool wrapped, so it cannot collide with a platform tool", () => {
        expect(canonicalToolName("mcp__other__commit_revision")).toBe("mcp__other__commit_revision")
        expect(canonicalToolName("mcp__other__x")).toBe("mcp__other__x")
        expect(canonicalToolName("mcp.other.commit_revision")).toBe("mcp.other.commit_revision")
    })

    it("never returns an empty name", () => {
        expect(canonicalToolName("mcp__agenta-tools__")).toBe("mcp__agenta-tools__")
        expect(canonicalToolName("mcp.agenta-tools.")).toBe("mcp.agenta-tools.")
        expect(canonicalToolName("")).toBe("")
    })
})

describe("resolveToolDisplay under an MCP wrapper", () => {
    it("applies the platform tool's override to the wrapped name", () => {
        // The commit summary is keyed by tool name, so it went missing under Claude too.
        const summary = resolveToolDisplay("mcp__agenta-tools__commit_revision").summary
        expect(summary?.({workflow_revision: {message: "Add the skill."}}, null)).toBe(
            "Add the skill.",
        )
    })

    it("still presents it as an MCP tool, and keeps the raw name reachable", () => {
        const display = resolveToolDisplay("mcp__agenta-tools__commit_revision")

        expect(display.kind).toBe("mcp")
        expect(display.raw).toBe("mcp__agenta-tools__commit_revision")
    })
})

// The wire name of one platform tool differs per harness (#5976). All three must read alike.
describe("resolveToolDisplay across harnesses", () => {
    it("reads the same whichever harness wrapped the tool", () => {
        const expected = {running: "Testing the agent", done: "Tested the agent"}

        expect(resolveToolDisplay("test_run").activity).toEqual(expected)
        expect(resolveToolDisplay("mcp__agenta-tools__test_run").activity).toEqual(expected)
        expect(resolveToolDisplay("mcp.agenta-tools.test_run").activity).toEqual(expected)
    })

    it("drops our own server's chip, which said nothing and differed per harness", () => {
        expect(resolveToolDisplay("mcp.agenta-tools.test_run").source).toBeUndefined()
        expect(resolveToolDisplay("mcp__agenta-tools__test_run").source).toBeUndefined()
        expect(resolveToolDisplay("test_run").source).toBeUndefined()
    })

    it("no longer leaks the Codex dot form into the label", () => {
        expect(resolveToolDisplay("mcp.agenta-tools.test_run").label).not.toContain("Mcp.")
    })
})

// Platform ops are `verb_noun`, so their wording is derived rather than written out one by one —
// a newly shipped op reads correctly with no registry entry.
describe("resolveToolDisplay derives our platform ops", () => {
    const done = (raw: string) => resolveToolDisplay(raw).activity.done

    it("conjugates the verb", () => {
        expect(done("create_schedule")).toBe("Created a schedule")
        expect(done("pause_schedule")).toBe("Paused a schedule")
        expect(done("list_schedules")).toBe("Checked schedules")
        expect(done("discover_tools")).toBe("Searched for tools")
    })

    it("says what the product calls the thing, not what the code calls it", () => {
        expect(done("create_subscription")).toBe("Created a trigger")
        expect(done("resume_subscription")).toBe("Resumed a trigger")
        expect(done("query_spans")).toBe("Looked through runs")
        expect(done("query_workflows")).toBe("Looked through agents")
        expect(done("read_config")).toBe("Read the agent's setup")
        expect(done("rename_session")).toBe("Renamed this chat")
        expect(done("commit_revision")).toBe("Saved changes")
    })

    // A session has exactly one agent, so "an agent" reads as if there were several.
    it("calls the session's own agent 'the agent'", () => {
        expect(done("rename_agent")).toBe("Renamed the agent")
        expect(done("test_run")).toBe("Tested the agent")
    })

    it("derives an op it has never seen", () => {
        expect(done("archive_schedule")).toBe("Archived a schedule")
    })

    it("derives the same wording under every harness wrapper", () => {
        expect(done("mcp.agenta-tools.create_subscription")).toBe("Created a trigger")
        expect(done("mcp__agenta-tools__create_subscription")).toBe("Created a trigger")
    })

    // The glossary is ours alone: a Stripe subscription is a subscription, not a trigger.
    it("never applies our vocabulary to an external tool", () => {
        expect(done("tools__composio__stripe__CANCEL_SUBSCRIPTION__c1")).toBe(
            "Cancelled a Stripe subscription",
        )
        expect(done("mcp__stripe__cancel_subscription")).toBe("Cancelled a Stripe subscription")
    })

    // Our own tools have no app to name: "Saved Agenta tools changes" would be nonsense.
    it("never names our own server inside the sentence", () => {
        expect(done("mcp.agenta-tools.commit_revision")).toBe("Saved changes")
        expect(done("mcp__agenta-tools__create_schedule")).toBe("Created a schedule")
    })
})

describe("resolveToolDisplay builds a tool search's sentence", () => {
    const found = (integration: string) => ({capabilities: [{integration}]})
    const sentence = (query: string, output?: unknown, appName?: string) =>
        resolveToolDisplay("discover_tools", {use_cases: [query]}, appName, output).activity.done

    // Eight searches in one turn all reading "Searched for …" is a wall; the query usually leads
    // with a verb of its own.
    it("varies the verb with what was searched for", () => {
        expect(sentence("list google calendar settings")).toBe("Checked google calendar settings")
        expect(sentence("get youtube channel activities")).toBe("Got youtube channel activities")
        expect(sentence("search events")).toBe("Searched events")
    })

    // A query says what the agent looked for, not what it did. Borrowing "send" would have a row
    // that only searched a catalog claim it sent something.
    it("never borrows a verb with a side effect", () => {
        expect(sentence("send a slack message")).toBe("Searched for send a slack message")
        expect(sentence("delete the calendar event")).toBe("Searched for delete the calendar event")
        expect(sentence("create a github issue")).toBe("Searched for create a github issue")
    })

    it("keeps the plain form when the query does not lead with a verb", () => {
        expect(sentence("hacker news top stories")).toBe("Searched for hacker news top stories")
    })

    it("keeps the plain form when the verb has nothing after it", () => {
        expect(sentence("list")).toBe("Searched for list")
    })

    // The query is model-written keyword salad. When the result reports which tool it matched, that
    // tool's own name describes the call — no cut length to pick, no words to guess.
    it("describes the tool it found rather than the keywords it searched with", () => {
        const withTool = (integration: string, action: string) => ({
            capabilities: [{integration, tool: {integration, action}}],
        })
        expect(
            sentence(
                "get youtube channel activities uploads recent",
                withTool("youtube", "LIST_CHANNEL_VIDEOS"),
                "YouTube",
            ),
        ).toBe("Checked YouTube channel videos")
        // Noun-first action names used to read with no tense at all.
        expect(
            sentence(
                "list google calendar events date range",
                withTool("googlecalendar", "EVENTS_LIST"),
                "Google Calendar",
            ),
        ).toBe("Checked Google Calendar events")
        expect(sentence("read gmail emails", withTool("gmail", "FETCH_EMAILS"), "Gmail")).toBe(
            "Fetched Gmail emails",
        )
    })

    // The call found the tool; it did not run it.
    it("never adopts a found tool whose verb has a side effect", () => {
        expect(
            sentence(
                "send email gmail",
                {
                    capabilities: [
                        {integration: "gmail", tool: {integration: "gmail", action: "SEND_EMAIL"}},
                    ],
                },
                "Gmail",
            ),
        ).toBe("Searched for Gmail send email")
    })

    it("keeps the app on the chip when the tool's own name already says which app it is", () => {
        const display = resolveToolDisplay(
            "discover_tools",
            {use_cases: ["list google tasks"]},
            "Google Tasks",
            {
                capabilities: [
                    {
                        integration: "googletasks",
                        tool: {integration: "googletasks", action: "LIST_TASKS"},
                    },
                ],
            },
        )
        expect(display.activity.done).toBe("Checked tasks")
        expect(display.source).toBe("Google Tasks")
    })

    // Falls back to the query when the search matched no tool at all.
    it("names the app it found and trims the keywords down to a qualifier", () => {
        expect(
            sentence("hacker news top stories front page", found("hackernews"), "Hacker News"),
        ).toBe("Searched for Hacker News top stories")
        expect(
            sentence(
                "list google calendar events date range",
                found("googlecalendar"),
                "Google Calendar",
            ),
        ).toBe("Checked Google Calendar events date")
        expect(sentence("list google tasks", found("googletasks"), "Google Tasks")).toBe(
            "Checked Google Tasks",
        )
    })

    it("reports the slug so the row can ask the catalog for the real spelling", () => {
        const display = resolveToolDisplay(
            "discover_tools",
            {use_cases: ["list google tasks"]},
            undefined,
            found("googletasks"),
        )
        expect(display.sourceKey).toBe("googletasks")
        // The squashed slug is not folded into the sentence: "Checked Googletasks google tasks"
        // stutters, because the slug's word boundaries do not match the query's.
        expect(display.activity.done).toBe("Checked google tasks")
        // Named inside the sentence once the catalog answers, so a chip would only repeat it.
        expect(display.source).toBeUndefined()
    })

    it("takes the slug off the matched tool when the capability does not carry one", () => {
        const display = resolveToolDisplay(
            "discover_tools",
            {use_cases: ["send email"]},
            undefined,
            {capabilities: [{tool: {integration: "gmail"}}]},
        )
        expect(display.sourceKey).toBe("gmail")
    })

    it("reads a result that is still JSON-encoded", () => {
        const display = resolveToolDisplay(
            "discover_tools",
            {use_cases: ["x"]},
            undefined,
            JSON.stringify(found("slack")),
        )
        expect(display.sourceKey).toBe("slack")
    })

    it("falls back to the query alone while the call is still in flight", () => {
        expect(sentence("list google calendar events date range")).toBe(
            "Checked google calendar events date range",
        )
    })

    // A fixed cut lands on a dangling word often enough to be worth handling.
    it("never ends the qualifier on a word that cannot end a phrase", () => {
        expect(
            sentence("youtube activities for the authenticated user", found("youtube"), "YouTube"),
        ).toBe("Searched for YouTube activities")
    })
})

describe("resolveToolDisplay for a tool that names an app in its arguments", () => {
    it("names the app it is asking you to connect", () => {
        const display = resolveToolDisplay("request_connection", {integration: "github"})

        expect(display.activity).toEqual({
            running: "Waiting for you to connect Github",
            done: "Asked you to connect Github",
        })
        // The slug is a catalog integration, so the row can ask for the real spelling.
        expect(display.sourceKey).toBe("github")
        // Named inside the sentence, so the chip would only stutter.
        expect(display.source).toBeUndefined()
    })

    it("takes the catalog's spelling once it answers", () => {
        const display = resolveToolDisplay("request_connection", {integration: "github"}, "GitHub")

        expect(display.activity.running).toBe("Waiting for you to connect GitHub")
    })

    it("still reads without naming an app when the call names none", () => {
        expect(resolveToolDisplay("request_connection", {}).activity.done).toBe(
            "Asked you to connect an app",
        )
    })

    it("keeps its wording under every harness wrapper", () => {
        const wrapped = resolveToolDisplay("mcp__agenta-tools__request_connection", {
            integration: "slack",
        })
        expect(wrapped.activity.done).toBe("Asked you to connect Slack")
    })
})

// Codex records a shell call under the command itself and a read under an English sentence, so
// neither name is a name. Both are recognised by argument shape / title pattern instead.
describe("resolveToolDisplay for Codex calls whose name is not a name", () => {
    const CODEX_SHELL = "pwd && rg --files .codex/skills | sed -n '1,80p'"

    it("reads a shell call as a command, with the command itself as the detail", () => {
        const display = resolveToolDisplay(CODEX_SHELL, {cwd: "/tmp/x", command: CODEX_SHELL})

        expect(display.kind).toBe("shell")
        expect(display.activity).toEqual({running: "Running a command", done: "Ran a command"})
        expect(display.detail).toContain("pwd && rg --files")
        expect(display.raw).toBe(CODEX_SHELL)
    })

    // Every path in a session sits under the sandbox root, so it is identical on every row and
    // crowds the sentence out of the line.
    it("strips the sandbox root from the shown command", () => {
        expect(
            resolveToolDisplay("x", {
                command: "find /tmp/agenta-sandbox-agent-wzkOSy/agents/skills -name '*.md'",
            }).detail,
        ).toBe("find agents/skills -name '*.md'")

        expect(
            resolveToolDisplay("x", {
                command:
                    "sed -n '1,20p' /tmp/agenta/mounts/019fe1f4-c599-7c82/019feff6-4b8f/.codex/SKILL.md",
            }).detail,
        ).toBe("sed -n '1,20p' .codex/SKILL.md")
    })

    it("keeps a real directory that merely sits near the root", () => {
        // "workspace" carries no digit, so it is a name rather than a generated id.
        expect(
            resolveToolDisplay("x", {command: "ls /tmp/agenta-sandbox-a1/workspace/src"}).detail,
        ).toBe("ls workspace/src")
    })

    it("strips the login-shell wrapper Codex adds around the real command", () => {
        const display = resolveToolDisplay("whatever", {
            command: `/bin/bash -lc "sed -n '1,200p' SKILL.md"`,
        })

        expect(display.detail).toBe("sed -n '1,200p' SKILL.md")
    })

    it("reads a file read as a file read, with just the filename as the detail", () => {
        const raw = "Read file '/tmp/agenta/mounts/019fe1f4/.codex/skills/build-an-agent/SKILL.md'"
        const display = resolveToolDisplay(raw, null)

        expect(display.kind).toBe("file")
        expect(display.activity).toEqual({running: "Reading a file", done: "Read a file"})
        expect(display.detail).toBe("SKILL.md")
    })

    it("reads a directory listing", () => {
        const display = resolveToolDisplay("List files in 'skills'", null)

        expect(display.activity.done).toBe("Listed files")
        expect(display.detail).toBe("skills")
    })

    it("still recognises a one-word command, where the title is the command", () => {
        expect(resolveToolDisplay("pwd", {command: "pwd"}).kind).toBe("shell")
    })

    it("leaves a properly named tool alone even when it takes a `command` argument", () => {
        const display = resolveToolDisplay("deploy", {command: "kubectl apply -f x"})

        expect(display.kind).not.toBe("shell")
        expect(display.label).toBe("Deploy")
    })

    it("shortens an unrecognised prose name rather than dumping it", () => {
        const raw = `sed -n '1,200p' ${"x".repeat(200)}`
        const display = resolveToolDisplay(raw)

        expect(display.label.length).toBeLessThanOrEqual(61)
        expect(display.activity.done).toBe(display.label)
    })
})

describe("resolveToolDisplay for harness builtins", () => {
    it("keys Claude's title-cased builtins and Pi's lowercase ones alike", () => {
        expect(resolveToolDisplay("Read").activity.done).toBe("Read a file")
        expect(resolveToolDisplay("read").activity.done).toBe("Read a file")
        expect(resolveToolDisplay("Bash").activity.done).toBe("Ran a command")
        expect(resolveToolDisplay("bash").activity.done).toBe("Ran a command")
    })

    // "Searched for tools" alone does not say what for, and the answer belongs in the sentence
    // rather than beside it: a use case is prose, not a filename.
    it("folds what was searched for into the sentence", () => {
        const display = resolveToolDisplay("discover_tools", {
            use_cases: ["send a Telegram message"],
        })

        expect(display.activity.done).toBe("Searched for send a Telegram message")
        expect(display.activity.running).toBe("Searching for send a Telegram message")
        // It joined the sentence, so it must not also sit in the detail slot.
        expect(display.detail).toBeUndefined()
    })

    // A regex is not prose: it keeps the monospace detail slot rather than joining the sentence.
    it("leaves a pattern in the detail slot", () => {
        const display = resolveToolDisplay("grep", {pattern: "TODO"})
        expect(display.activity.done).toBe("Searched files")
        expect(display.detail).toBe("TODO")
    })

    it("ignores a query argument that is not text", () => {
        expect(resolveToolDisplay("query_spans", {query: {filter: "x"}}).detail).toBeUndefined()
    })

    it("takes the detail from whichever argument the builtin carries", () => {
        expect(resolveToolDisplay("Read", {file_path: "/repo/src/index.ts"}).detail).toBe(
            "index.ts",
        )
        expect(resolveToolDisplay("Grep", {pattern: "TODO"}).detail).toBe("TODO")
    })
})

// External tools cannot be listed by hand, so their wording is derived from the structured name.
// The app is named inside the sentence ("Searched GitHub issues"), which retires the chip.
describe("resolveToolDisplay for external tools", () => {
    const GITHUB_SEARCH = "tools__composio__github__SEARCH_ISSUES__a4f"

    it("names the app inside the sentence and drops the now-redundant chip", () => {
        const display = resolveToolDisplay(GITHUB_SEARCH)

        expect(display.activity.done).toBe("Searched Github issues")
        expect(display.source).toBeUndefined()
        expect(display.label).toBe("Search issues")
    })

    // The app's real name lives in the tool catalog, which answers asynchronously, so the row
    // resolves once for the slug and again with the name. Title case is the first-paint fallback.
    it("takes the catalog's app name when the caller supplies it", () => {
        expect(resolveToolDisplay(GITHUB_SEARCH).sourceKey).toBe("github")
        expect(resolveToolDisplay(GITHUB_SEARCH, undefined, "GitHub").activity).toEqual({
            running: "Searching GitHub issues",
            done: "Searched GitHub issues",
        })
    })

    it("puts the article before the app for a singular object", () => {
        expect(resolveToolDisplay("tools__composio__gmail__SEND_EMAIL__b81").activity.done).toBe(
            "Sent a Gmail email",
        )
        expect(
            resolveToolDisplay("googledrive__UPLOAD_FILE", undefined, "Google Drive").activity.done,
        ).toBe("Uploaded a Google Drive file")
    })

    it("reports the slug for the generic {source}__ACTION form too", () => {
        expect(resolveToolDisplay("googledrive__UPLOAD_FILE").sourceKey).toBe("googledrive")
    })

    // "Got Google Calendar calendar settings" stutters, so the app steps back into the chip.
    // Both spellings must be caught: the catalog's "Google Calendar" and, before it answers, the
    // run-together slug "Googlecalendar" the row paints first.
    it("skips the app when the object already says which app it is", () => {
        const raw = "tools__composio__googlecalendar__GET_CALENDAR_SETTINGS__c1"

        const fromCatalog = resolveToolDisplay(raw, undefined, "Google Calendar")
        expect(fromCatalog.activity.done).toBe("Got calendar settings")
        expect(fromCatalog.source).toBe("Google Calendar")

        const firstPaint = resolveToolDisplay(raw)
        expect(firstPaint.activity.done).toBe("Got calendar settings")
        expect(firstPaint.source).toBe("Googlecalendar")
    })

    it("keeps the app when the object merely shares a short fragment with the slug", () => {
        // "file" is inside "googledrive" only by accident of length, so it must not trip the rule.
        expect(resolveToolDisplay("googledrive__UPLOAD_FILE").activity.done).toBe(
            "Uploaded a Googledrive file",
        )
    })

    it("matches whole words only, so a near-miss still names the app", () => {
        // "Gmail" and "email" share no word, so this stays redundant rather than guessing.
        expect(
            resolveToolDisplay("tools__composio__gmail__SEND_EMAIL__b81", undefined, "Gmail")
                .activity.done,
        ).toBe("Sent a Gmail email")
    })

    it("names the server for a third-party MCP tool under either harness's wrapper", () => {
        for (const raw of ["mcp__linear__create_issue", "mcp.linear.create_issue"]) {
            const display = resolveToolDisplay(raw)
            expect(display.activity.done).toBe("Created a Linear issue")
            // An MCP server is not a tool-catalog integration, so there is nothing to look up.
            expect(display.sourceKey).toBeUndefined()
            expect(display.source).toBeUndefined()
        }
    })

    // An action name that carries its own article used to land it mid-phrase: "Created GitHub an
    // issue".
    it("puts the article in front of the app, not between it and the noun", () => {
        expect(
            resolveToolDisplay("tools__composio__github__CREATE_AN_ISSUE__c1", {}, "GitHub")
                .activity.done,
        ).toBe("Created a GitHub issue")
        expect(
            resolveToolDisplay("tools__composio__slack__SEND_A_MESSAGE__c1", {}, "Slack").activity
                .done,
        ).toBe("Sent a Slack message")
    })

    // Plenty of catalog actions are noun-first, and those used to read with no tense at all.
    it("finds the verb at the end of an action name too", () => {
        expect(
            resolveToolDisplay(
                "tools__composio__googlecalendar__EVENTS_LIST__c1",
                {},
                "Google Calendar",
            ).activity,
        ).toEqual({
            running: "Checking Google Calendar events",
            done: "Checked Google Calendar events",
        })
    })

    // Without a verb there is no sentence to fold the app into, so the chip still carries it.
    it("leaves an action alone when its leading word is not a verb we know", () => {
        const display = resolveToolDisplay("tools__composio__slack__FOO_BAR__c2")

        expect(display.label).toBe("Foo bar")
        expect(display.activity).toEqual({running: "Foo bar", done: "Foo bar"})
        expect(display.source).toBe("Slack")
    })
})
