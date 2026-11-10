import {describe, expect, it} from "vitest"

import {filterApps} from "@/features/evaluations/new/appTypeFilter"
import {
    createInitialDraft,
    draftHasInput,
    expectedInputVariables,
    newEvaluationReducer,
    validateDraft,
    type DraftApp,
    type DraftEvaluator,
    type DraftRevision,
    type DraftTestset,
    type NewEvaluationAction,
    type NewEvaluationDraft,
    type NewEvaluationKind,
} from "@/features/evaluations/new/newEvaluationDraft"
import {flattenTree, toggleKey} from "@/features/evaluations/new/treeRows"

const app: DraftApp = {id: "app-1", name: "Support bot"}
const otherApp: DraftApp = {id: "app-2", name: "Search bot"}
const revisionA: DraftRevision = {id: "rev-a", variantName: "default", version: 3}
const revisionB: DraftRevision = {id: "rev-b", variantName: "concise", version: 1}
const testset: DraftTestset = {
    revisionId: "ts-rev-1",
    testsetId: "ts-1",
    name: "greetings",
    version: 2,
}
const evaluator: DraftEvaluator = {
    revisionId: "ev-rev-1",
    evaluatorId: "ev-1",
    name: "Exact match",
    version: 1,
}

const run = (draft: NewEvaluationDraft, ...actions: NewEvaluationAction[]) =>
    actions.reduce(newEvaluationReducer, draft)

const start = (kind: NewEvaluationKind = "auto") => createInitialDraft(kind, {suffix: "abc12"})

describe("new evaluation draft", () => {
    it("A typed name stays when an app is picked, changed or cleared, and later picks keep it", () => {
        const typed = run(start(), {type: "setName", name: "my run"})
        const picked = run(typed, {type: "pickApp", app})
        expect(picked.name).toBe("my run")
        expect(run(picked, {type: "pickApp", app: otherApp}).name).toBe("my run")
        expect(run(picked, {type: "clearApp"}).name).toBe("my run")
        const later = run(
            picked,
            {type: "pickRevision", revision: revisionA},
            {type: "pickTestset", testset},
        )
        expect(later.name).toBe("my run")
    })

    it("An auto name gives way to the next app, and a cleared name auto-fills again", () => {
        const named = run(
            start(),
            {type: "pickApp", app},
            {type: "pickRevision", revision: revisionA},
            {type: "pickTestset", testset},
        )
        expect(named.name).toBe("default-v3-greetings-abc12")
        expect(run(named, {type: "pickApp", app: otherApp}).name).toBe("")
        const cleared = run(
            {...named, name: "mine"},
            {type: "setName", name: ""},
            {type: "blurName"},
        )
        expect(cleared.name).toBe("default-v3-greetings-abc12")
    })

    it("Picking another app clears revisions, test set, evaluators, name and settings", () => {
        const filled = run(
            start(),
            {type: "pickApp", app},
            {type: "pickRevision", revision: revisionA},
            {type: "pickTestset", testset},
            {type: "pickEvaluator", evaluator},
            {type: "setConcurrency", field: "batch_size", value: 4},
        )
        expect(filled.name).not.toBe("")

        const next = run(filled, {type: "pickApp", app: otherApp})
        expect(next.app).toEqual(otherApp)
        expect(next.revisions).toEqual([])
        expect(next.testset).toBeNull()
        expect(next.evaluators).toEqual([])
        expect(next.name).toBe("")
        expect(next.concurrency).toEqual({batch_size: 10, max_retries: 3, retry_delay: 3})
        expect(next.section).toBe("revision")
    })

    it("Picking the same app changes nothing", () => {
        const picked = run(
            start(),
            {type: "pickApp", app},
            {type: "pickRevision", revision: revisionA},
        )
        expect(run(picked, {type: "pickApp", app: {...app}})).toBe(picked)
    })

    it("One revision and a test set produce variant-vN-testset-suffix", () => {
        const draft = run(
            start(),
            {type: "pickApp", app},
            {type: "pickRevision", revision: revisionA},
            {type: "pickTestset", testset},
        )
        expect(draft.name).toBe("default-v3-greetings-abc12")
    })

    it("Several revisions produce N-variants-testset-suffix", () => {
        const draft = run(
            start(),
            {type: "pickApp", app},
            {type: "pickRevision", revision: revisionA},
            {type: "pickRevision", revision: revisionB},
            {type: "pickTestset", testset},
        )
        expect(draft.name).toBe("2-variants-greetings-abc12")
        // The name follows the picks while it is still the auto name.
        expect(run(draft, {type: "removeRevision", revisionId: "rev-b"}).name).toBe(
            "default-v3-greetings-abc12",
        )
    })

    it("A typed name is never replaced by the auto name", () => {
        const draft = run(
            start(),
            {type: "pickApp", app},
            {type: "pickRevision", revision: revisionA},
            {type: "setName", name: "My run"},
            {type: "pickTestset", testset},
            {type: "pickRevision", revision: revisionB},
        )
        expect(draft.name).toBe("My run")
    })

    it("A cleared name returns to the auto name", () => {
        const draft = run(
            start(),
            {type: "pickApp", app},
            {type: "pickRevision", revision: revisionA},
            {type: "pickTestset", testset},
            {type: "setName", name: ""},
        )
        expect(draft.name).toBe("")
        expect(run(draft, {type: "blurName"}).name).toBe("default-v3-greetings-abc12")
    })

    it("Human mode keeps only one revision", () => {
        const draft = run(
            start("human"),
            {type: "pickApp", app},
            {type: "pickRevision", revision: revisionA},
            {type: "pickRevision", revision: revisionB},
        )
        expect(draft.revisions).toEqual([revisionB])
        expect(draft.section).toBe("testset")
    })

    it("Human mode keeps one revision of each evaluator, auto mode keeps every pick", () => {
        const second: DraftEvaluator = {...evaluator, revisionId: "ev-rev-2", version: 2}
        const pickBoth = (kind: NewEvaluationKind) =>
            run(
                start(kind),
                {type: "pickEvaluator", evaluator},
                {type: "pickEvaluator", evaluator: second},
            ).evaluators
        expect(pickBoth("human")).toEqual([second])
        expect(pickBoth("auto")).toEqual([evaluator, second])
    })

    it("Picking the selected test set revision again clears it", () => {
        const picked = run(start(), {type: "pickApp", app}, {type: "pickTestset", testset})
        expect(picked.section).toBe("evaluators")
        expect(run(picked, {type: "pickTestset", testset}).testset).toBeNull()
    })

    it("Opens on Revision for a scoped app and on Test set for given revisions", () => {
        expect(createInitialDraft("auto", {app}).section).toBe("revision")
        expect(createInitialDraft("auto", {app, revisions: [revisionA]}).section).toBe("testset")
        expect(createInitialDraft("auto").section).toBe("application")
    })

    it("Validation reports the name first, then the test set revision, then the revision, then the evaluators", () => {
        let draft = run(start(), {type: "pickApp", app})
        expect(validateDraft(draft)).toMatchObject({message: "Please enter evaluation name"})

        draft = run(draft, {type: "setName", name: "Run"})
        expect(validateDraft(draft)).toEqual({
            section: "testset",
            message: "Please select a test set revision",
        })

        draft = run(draft, {type: "pickTestset", testset})
        expect(validateDraft(draft)).toEqual({
            section: "revision",
            message: "Please select a revision",
        })

        draft = run(draft, {type: "pickRevision", revision: revisionA})
        expect(validateDraft(draft)).toEqual({
            section: "evaluators",
            message: "Please select evaluator configuration",
        })

        draft = run(draft, {type: "pickEvaluator", evaluator})
        expect(validateDraft(draft)).toBeNull()
    })

    it("An empty concurrency field fails validation", () => {
        const draft = run(
            start(),
            {type: "pickApp", app},
            {type: "pickRevision", revision: revisionA},
            {type: "pickTestset", testset},
            {type: "pickEvaluator", evaluator},
            {type: "setConcurrency", field: "retry_delay", value: null},
        )
        expect(validateDraft(draft)).toEqual({
            section: "settings",
            message: "This field is required",
        })
        expect(validateDraft(run(draft, {type: "resetConcurrency"}))).toBeNull()
    })

    it("Expected input variables also read plain prompt messages", () => {
        const names = expectedInputVariables([
            {
                data: {
                    parameters: {
                        prompt: {
                            messages: [
                                {role: "user", content: "Translate {{text}} to {{language}}"},
                            ],
                        },
                    },
                },
            },
        ])
        expect(names).toEqual(["text", "language"])
    })

    it("Expected input variables join input keys and prompt variables", () => {
        const names = expectedInputVariables([
            {
                data: {
                    parameters: {
                        ag_config: {
                            prompt: {
                                input_keys: ["country", " topic "],
                                messages: {
                                    value: [
                                        {
                                            content: {
                                                value: "Tell me about {{country}} and {{ city }}",
                                            },
                                        },
                                        {
                                            content: {
                                                value: [{text: {value: "More on {{language}}"}}],
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
            {data: null},
        ])
        expect(names).toEqual(["country", "topic", "city", "language"])
    })
})

describe("whether a draft holds input", () => {
    it("An empty draft holds none, so it closes without a question", () => {
        expect(draftHasInput(start())).toBe(false)
    })

    it("Picks the sheet opened with are not input", () => {
        const opening = {app, revisions: [revisionA]}
        expect(draftHasInput(createInitialDraft("auto", opening), opening)).toBe(false)
    })

    it("A name, an app, a revision, a test set, an evaluator or a setting is input", () => {
        expect(draftHasInput(run(start(), {type: "setName", name: "run"}))).toBe(true)
        expect(draftHasInput(run(start(), {type: "pickApp", app}))).toBe(true)
        const scoped = {app}
        const withApp = createInitialDraft("auto", scoped)
        expect(
            draftHasInput(run(withApp, {type: "pickRevision", revision: revisionA}), scoped),
        ).toBe(true)
        expect(draftHasInput(run(withApp, {type: "pickTestset", testset}), scoped)).toBe(true)
        expect(draftHasInput(run(withApp, {type: "pickEvaluator", evaluator}), scoped)).toBe(true)
        expect(
            draftHasInput(
                run(withApp, {type: "setConcurrency", field: "batch_size", value: 4}),
                scoped,
            ),
        ).toBe(true)
    })

    it("Removing a revision the sheet opened with is input", () => {
        const opening = {app, revisions: [revisionA, revisionB]}
        const draft = run(createInitialDraft("auto", opening), {
            type: "removeRevision",
            revisionId: revisionB.id,
        })
        expect(draftHasInput(draft, opening)).toBe(true)
    })
})

describe("step table rows", () => {
    const rows = [
        {id: "v5", group: "verbose"},
        {id: "d3", group: "default"},
        {id: "d2", group: "default"},
        {id: "d1", group: "default"},
    ]

    it("Shows the newest row of each group with the count of its older rows", () => {
        const tree = flattenTree(rows, (row) => row.group, new Set())
        expect(tree.map(({row, depth, olderCount}) => [row.id, depth, olderCount])).toEqual([
            ["v5", 0, 0],
            ["d3", 0, 2],
        ])
    })

    it("An expanded group shows its older rows right under its newest one", () => {
        const tree = flattenTree(rows, (row) => row.group, toggleKey(new Set(), "default"))
        expect(tree.map(({row, depth}) => [row.id, depth])).toEqual([
            ["v5", 0],
            ["d3", 0],
            ["d2", 1],
            ["d1", 1],
        ])
        expect(toggleKey(new Set(["default"]), "default").has("default")).toBe(false)
    })
})

describe("the app type filter", () => {
    const apps = [
        {id: "a", name: "Capital finder"},
        {id: "b", name: "Support bot"},
        {id: "c", name: "Translator"},
    ]
    const types = new Map([
        ["a", "completion" as const],
        ["b", "chat" as const],
        ["c", null],
    ])

    it("Keeps the apps of the picked type, and an app of unknown type only under All types", () => {
        expect(filterApps(apps, types, "", "chat").map((app) => app.id)).toEqual(["b"])
        expect(filterApps(apps, types, "", "completion").map((app) => app.id)).toEqual(["a"])
        expect(filterApps(apps, types, "", "all").map((app) => app.id)).toEqual(["a", "b", "c"])
    })

    it("Matches the search on the name, ignoring case", () => {
        expect(filterApps(apps, types, "  SUPPORT ", "all").map((app) => app.id)).toEqual(["b"])
    })
})
