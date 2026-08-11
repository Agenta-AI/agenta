import {describe, expect, it} from "vitest"

import {
    filterSections,
    flattenSections,
    isSameRun,
    matchLabel,
    readCommandRun,
    runFollowsBoundary,
    type SlashCommandSection,
} from "../../src/RichChatInput/assets/slashCommands"

const section = (key: string, labels: string[]): SlashCommandSection => ({
    key,
    title: key,
    items: labels.map((label) => ({key: label, label, kind: "insert" as const})),
})

describe("readCommandRun", () => {
    it("opens on a `/` that starts the text", () => {
        expect(readCommandRun("/mod")).toEqual({query: "mod", start: 0, afterSpace: false})
    })

    it("opens on a `/` following a space, mid-message", () => {
        expect(readCommandRun("hello /mod")).toEqual({query: "mod", start: 6, afterSpace: true})
    })

    it("reports the empty query for a bare `/`", () => {
        expect(readCommandRun("/")).toEqual({query: "", start: 0, afterSpace: false})
    })

    // The guards that keep the menu out of ordinary prose.
    it.each([
        ["and/or", "a slash inside a word"],
        ["https://agenta.ai", "a URL"],
        ["src/components/Foo", "a path"],
        ["/model ", "a run the caret has left"],
        ["", "empty text"],
        ["plain text", "text with no slash"],
    ])("declines %j (%s)", (text) => {
        expect(readCommandRun(text)).toBeNull()
    })

    it("tracks the run's start as it moves through the message", () => {
        expect(readCommandRun("a /x")?.start).toBe(2)
        expect(readCommandRun("aa /x")?.start).toBe(3)
    })
})

describe("runFollowsBoundary", () => {
    // A run flush against its node's start is only disqualified by real preceding TEXT. Formatting
    // splits a paragraph into sibling text nodes, so `hello ` + bold `/model` must still open —
    // the old check rejected any previous sibling at all.
    it("allows a run that starts the block", () => {
        expect(runFollowsBoundary("")).toBe(true)
    })

    it("allows a run whose preceding sibling ends in a space", () => {
        expect(runFollowsBoundary("hello ")).toBe(true)
    })

    it("allows a run preceded by a newline", () => {
        expect(runFollowsBoundary("hello\n")).toBe(true)
    })

    it("rejects a run butted against a word, the `and/or` case across nodes", () => {
        expect(runFollowsBoundary("and")).toBe(false)
        expect(runFollowsBoundary("https:/")).toBe(false)
    })
})

describe("isSameRun", () => {
    const run = (nodeKey: string, start: number) => ({nodeKey, start})

    it("matches a run against itself as the query grows", () => {
        expect(isSameRun(run("1", 0), run("1", 0))).toBe(true)
    })

    // The F1 regression: a dismissal must not leak onto the next run. A single insertion (paste,
    // IME commit, coalesced typing) moves the caret straight from one run into another, so
    // "a run exists" is not enough to keep the menu suppressed.
    it("does not match a different run in the same node", () => {
        expect(isSameRun(run("1", 0), run("1", 9))).toBe(false)
    })

    it("does not match the same offset in a different node", () => {
        expect(isSameRun(run("1", 0), run("2", 0))).toBe(false)
    })

    it("never matches when either side is absent", () => {
        expect(isSameRun(null, run("1", 0))).toBe(false)
        expect(isSameRun(run("1", 0), null)).toBe(false)
        expect(isSameRun(null, null)).toBe(false)
    })
})

describe("matchLabel", () => {
    it("matches past the leading slash, so `/mo` hits `/model` at its start", () => {
        expect(matchLabel("/model", "mo")).toEqual({before: "/", match: "mo", after: "del"})
    })

    it("matches inside the name", () => {
        expect(matchLabel("/notion.move_page", "move")).toEqual({
            before: "/notion.",
            match: "move",
            after: "_page",
        })
    })

    it("ignores case", () => {
        expect(matchLabel("/Model", "mod")?.match).toBe("Mod")
    })

    it("returns the whole label unmarked for an empty query", () => {
        expect(matchLabel("/model", "")).toEqual({before: "/model", match: "", after: ""})
    })

    it("returns null when nothing matches", () => {
        expect(matchLabel("/model", "zzz")).toBeNull()
    })
})

describe("filterSections", () => {
    const sections = [
        section("commands", ["/model", "/harness"]),
        section("tools", ["/notion.move_page"]),
    ]

    it("keeps every non-empty section when there is no query", () => {
        expect(filterSections(sections, "")).toHaveLength(2)
    })

    it("drops sections whose items all filtered out", () => {
        expect(filterSections(sections, "harn").map((s) => s.key)).toEqual(["commands"])
    })

    it("ranks a prefix match above a substring match", () => {
        const [first] = filterSections([section("all", ["/notion.move_page", "/model"])], "mo")
        expect(first.items.map((item) => item.label)).toEqual(["/model", "/notion.move_page"])
    })

    it("returns nothing when no item matches", () => {
        expect(filterSections(sections, "zzz")).toEqual([])
    })

    it("does not mutate the input sections", () => {
        const input = [section("commands", ["/model", "/harness"])]
        filterSections(input, "harn")
        expect(input[0].items.map((item) => item.label)).toEqual(["/model", "/harness"])
    })
})

describe("flattenSections", () => {
    it("walks sections as one list, in order", () => {
        expect(
            flattenSections([section("a", ["/one", "/two"]), section("b", ["/three"])]).map(
                (item) => item.label,
            ),
        ).toEqual(["/one", "/two", "/three"])
    })

    it("is empty for no sections", () => {
        expect(flattenSections([])).toEqual([])
    })
})
