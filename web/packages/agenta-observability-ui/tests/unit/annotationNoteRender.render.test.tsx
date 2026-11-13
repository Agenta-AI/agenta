/** @vitest-environment jsdom */
import {act} from "react"

import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import AnnotationTabItem from "../../src/traceDrawer/AnnotationTabItem"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const dummyQueryAtom = atom({data: undefined})
    return {
        evaluatorsListDataAtom: atom([
            {
                id: "ev-1",
                slug: "test-evaluator",
                name: "Test Evaluator",
                data: {},
            },
        ]),
        resolveOutputSchemaProperties: () => ({
            complex_note: {type: "string"},
        }),
        workflowLatestRevisionQueryAtomFamily: () => dummyQueryAtom,
    }
})

vi.mock("../../src/traceDrawer/EvaluatorDetailsPopover", () => ({
    default: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))

vi.mock("@agenta/observability/traceDrawer", () => ({
    useEvaluatorNavigation: () => ({
        openEvaluatorInNewTab: () => undefined,
        canNavigate: false,
    }),
}))

describe("AnnotationTabItem Note Column Rendering (Issue #8094)", () => {
    let container: HTMLDivElement | null = null
    let root: Root | null = null

    beforeEach(() => {
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => {
            root?.unmount()
        })
        container?.remove()
        root = null
        container = null
    })

    it("renders plain string note as text, not wrapped JSON ({ value, type })", async () => {
        const annotation = {
            span_id: "span-123",
            origin: "human",
            references: {
                evaluator: {
                    slug: "test-evaluator",
                },
            },
            data: {
                outputs: {
                    notes: {
                        reviewer_note: "obs qa note",
                    },
                },
            },
        } as unknown as AnnotationDto

        const store = createStore()

        await act(async () => {
            root?.render(
                <Provider store={store}>
                    <AnnotationTabItem annotations={[annotation]} />
                </Provider>,
            )
        })

        const textContent = container?.textContent || ""

        // Regression assertion: Note column must show the unwrapped note text
        expect(textContent).toContain("obs qa note")

        // Must NOT show raw internal wrapper JSON serialization ({ "value": "obs qa note", "type": "string" })
        expect(textContent).not.toContain('"value": "obs qa note"')
        expect(textContent).not.toContain('"type": "string"')
    })

    it("preserves pretty-printed JSON when note value is a structured object", async () => {
        const annotation = {
            span_id: "span-456",
            origin: "human",
            references: {
                evaluator: {
                    slug: "test-evaluator",
                },
            },
            data: {
                outputs: {
                    notes: {
                        complex_note: {
                            rating: 5,
                            tag: "accurate",
                        },
                    },
                },
            },
        } as unknown as AnnotationDto

        const store = createStore()

        await act(async () => {
            root?.render(
                <Provider store={store}>
                    <AnnotationTabItem annotations={[annotation]} />
                </Provider>,
            )
        })

        const textContent = container?.textContent || ""
        expect(textContent).toContain('"rating": 5')
        expect(textContent).toContain('"tag": "accurate"')
    })
})
