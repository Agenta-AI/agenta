/**
 * The details column of the read-only revision drawer (card A-T3, rows A13 to A20).
 *
 * The molecules and the evaluator catalog are replaced by plain atoms. Each test sets the atoms it
 * needs with `put`. The catalog atom counts its reads, so a test can prove it is never read for
 * variant or deployment revisions.
 */
import {act, type ComponentProps} from "react"

import {atom, createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {reads, values} = vi.hoisted(() => ({
    reads: {count: 0},
    values: new Map<string, unknown>(),
}))

vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const empty = atom<unknown>(null)
    const select = (name: string) => (id: string) => values.get(`${name}:${id}`) ?? empty
    return {
        workflowMolecule: {
            selectors: {
                data: select("data"),
                variantLabel: select("variantLabel"),
                isEvaluator: select("isEvaluator"),
                artifactSlug: select("artifactSlug"),
            },
        },
        parseEvaluatorKeyFromUri: (uri: string | null | undefined) => uri?.split(":")[2] ?? null,
        evaluatorTemplatesMapAtom: atom(() => {
            reads.count++
            return new Map([["auto_exact_match", "Exact Match"]])
        }),
    }
})

vi.mock("@agenta/entities/environment", async () => {
    const {atom} = await import("jotai")
    const empty = atom<unknown>([])
    return {
        environmentMolecule: {
            atoms: {
                revisionDeployment: (id: string) => values.get(`deploy:${id}`) ?? empty,
            },
        },
    }
})

vi.mock("@agenta/entities/shared", () => ({
    UserAuthorLabel: ({userId}: {userId?: string | null}) => (
        <span data-testid="author">{userId}</span>
    ),
}))

vi.mock("../../src/variant/VariantDetailsWithStatus", () => ({
    default: ({
        variantName,
        revision,
    }: {
        variantName?: string
        revision?: number | string | null
    }) => <div data-testid="variant-details">{`${variantName ?? ""}|${revision ?? ""}`}</div>,
}))

import {RevisionDetails} from "../../src/variant/RevisionDrawer/RevisionDetails"

const EVALUATOR_URI = "agenta:builtin:auto_exact_match:v0"

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

const put = (key: string, value: unknown) => values.set(key, atom(value))

const revision = (overrides: Record<string, unknown> = {}) => ({
    id: "rev-1",
    version: 3,
    slug: "fallback-slug",
    workflow_id: "wf-1",
    created_at: "2026-01-02T10:00:00Z",
    created_by_id: "user-1",
    message: null,
    data: {uri: EVALUATOR_URI},
    ...overrides,
})

const render = async (props: ComponentProps<typeof RevisionDetails>) => {
    await act(async () => {
        root.render(
            <Provider store={store}>
                <RevisionDetails {...props} />
            </Provider>,
        )
    })
}

const LABEL_SELECTOR = ".text-xs.font-medium.text-muted-foreground"

const labelElement = (label: string) =>
    [...document.querySelectorAll<HTMLElement>(LABEL_SELECTOR)].find(
        (el) => el.textContent === label,
    ) ?? null

const labelTexts = () =>
    [...document.querySelectorAll<HTMLElement>(LABEL_SELECTOR)].map((el) => el.textContent)

const valueOf = (label: string) => labelElement(label)?.nextElementSibling?.textContent ?? null

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    values.clear()
    reads.count = 0
    store = createStore()
    put("data:rev-1", revision())
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("RevisionDetails", () => {
    it("Deployment details show the variant row", async () => {
        put("data:rev-1", revision({version: 3}))
        put("variantLabel:rev-1", "support-bot")
        await render({revisionId: "rev-1", kind: "deployment"})

        expect(document.querySelector("h3")?.textContent).toBe("Details")
        expect(labelTexts()).toContain("Variant")
        expect(document.querySelector("[data-testid=variant-details]")?.textContent).toBe(
            "support-bot|3",
        )
        expect(labelTexts()).not.toContain("Type")
        expect(labelTexts()).not.toContain("Slug")
    })

    it("Evaluator details show type and slug", async () => {
        put("isEvaluator:rev-1", true)
        put("artifactSlug:rev-1", "exact-match-slug")
        await render({revisionId: "rev-1", kind: "evaluator"})

        expect(valueOf("Type")).toBe("Exact Match")
        expect(valueOf("Slug")).toBe("exact-match-slug")
        expect(labelTexts()).not.toContain("Variant")
    })

    it("The note row shows only when the revision has a message", async () => {
        put("data:rev-1", revision({message: "Fixed the prompt"}))
        await render({revisionId: "rev-1", kind: "variant"})
        expect(valueOf("Note")).toBe("Fixed the prompt")

        put("data:rev-1", revision({message: null}))
        await render({revisionId: "rev-1", kind: "variant"})
        expect(labelTexts()).not.toContain("Note")

        put("data:rev-1", revision({message: ""}))
        await render({revisionId: "rev-1", kind: "variant"})
        expect(labelTexts()).not.toContain("Note")
    })

    it("The deployment row lists each environment the revision is in", async () => {
        put("deploy:rev-1", [
            {name: "production", id: "env-1"},
            {name: "staging", id: "env-2"},
        ])
        await render({revisionId: "rev-1", kind: "variant"})

        const tags = labelElement("Deployment")?.nextElementSibling?.firstElementChild
        expect(tags?.children).toHaveLength(2)
        expect(tags?.textContent).toContain("production")
        expect(tags?.textContent).toContain("staging")
    })

    it("Variant details read no evaluator catalog", async () => {
        put("isEvaluator:rev-1", false)
        await render({revisionId: "rev-1", kind: "variant"})
        await render({revisionId: "rev-1", kind: "deployment"})
        await render({revisionId: "rev-1", kind: "evaluator"})

        expect(reads.count).toBe(0)
    })
})
