import {useCallback, useMemo, useState} from "react"

import {DrillInContent} from "@agenta/ui/drill-in"
import type {PathItem} from "@agenta/ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * DrillInContent — the @agenta/ui entity-independent drill-in navigation engine
 * (`@agenta/ui/drill-in`).
 *
 * The engine is deliberately dependency-free: it navigates nested data via injected
 * `getValue` / `setValue` / `getRootItems` callbacks and renders field content through
 * an injectable renderer (a simple default is built in). This story wires those
 * callbacks to a PLAIN in-memory mock object held in React state — no molecules, no
 * atoms, no entity adapters. That is exactly the seam this component was built for:
 * the presentational drill-in (breadcrumb + field list + controls) is here; the app's
 * data logic is only the adapter that produces getValue/setValue over a real entity.
 */
const meta = {
    title: "@agenta/ui/Domain/DrillIn",
    component: DrillInContent,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The @agenta/ui entity-independent drill-in navigation engine (breadcrumb + field list + controls). Wired here to a plain in-memory mock object via injected getValue/setValue/getRootItems callbacks — no molecules, atoms, or entity adapters.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

// Mock nested entity data — stands in for a workflow revision / testset row config.
const INITIAL_DATA = {
    model: "gpt-4o",
    temperature: 0.7,
    streaming: true,
    inputs: {
        prompt: "Summarize the following document in three bullet points.",
        max_bullets: 3,
    },
    tools: ["retrieval", "code_interpreter"],
    metadata: {
        owner: "Ada",
        tags: ["prod", "eval"],
    },
}

// Walk a plain object by a string[] path.
const getAtPath = (root: unknown, path: string[]): unknown =>
    path.reduce<unknown>((acc, key) => {
        if (acc == null) return undefined
        if (Array.isArray(acc)) return acc[Number(key)]
        return (acc as Record<string, unknown>)[key]
    }, root)

const toRootItems = (obj: Record<string, unknown>): PathItem[] =>
    Object.entries(obj).map(([key, value]) => ({key, name: key, value}))

const EditableDrillIn = () => {
    const [data, setData] = useState<Record<string, unknown>>(INITIAL_DATA)

    const getValue = useCallback((path: string[]) => getAtPath(data, path), [data])

    const setValue = useCallback((path: string[], value: unknown) => {
        setData((prev) => {
            if (path.length === 0) return value as Record<string, unknown>
            const next = structuredClone(prev)
            let cursor = next as Record<string, unknown>
            for (let i = 0; i < path.length - 1; i++) {
                cursor = cursor[path[i]] as Record<string, unknown>
            }
            cursor[path[path.length - 1]] = value
            return next
        })
    }, [])

    const getRootItems = useCallback(() => toRootItems(data), [data])

    const columnOptions = useMemo(
        () => [
            {value: "col_prompt", label: "Prompt column"},
            {value: "col_answer", label: "Answer column"},
        ],
        [],
    )

    return (
        <div className="max-w-[640px] border border-colorBorderSecondary rounded-md p-4">
            <div className="mb-3 text-xs text-colorTextSecondary">
                Mocked plain-object entity · getValue/setValue/getRootItems over React state
            </div>
            <DrillInContent
                getValue={getValue}
                setValue={setValue}
                getRootItems={getRootItems}
                rootTitle="config"
                editable
                showCollapse
                showProperties
                valueMode="native"
                columnOptions={columnOptions}
            />
        </div>
    )
}

const ReadOnlyDrillIn = () => {
    const data = INITIAL_DATA as Record<string, unknown>
    const getValue = useCallback((path: string[]) => getAtPath(data, path), [data])
    const noop = useCallback(() => {}, [])
    const getRootItems = useCallback(() => toRootItems(data), [data])

    return (
        <div className="max-w-[640px] border border-colorBorderSecondary rounded-md p-4">
            <DrillInContent
                getValue={getValue}
                setValue={noop}
                getRootItems={getRootItems}
                rootTitle="config"
                editable={false}
                showCollapse
                showProperties
                valueMode="native"
            />
        </div>
    )
}

export const MockedNestedData: Story = {
    render: () => <EditableDrillIn />,
}

/**
 * Read-only variant — same mocked data, `editable={false}`.
 */
export const ReadOnly: Story = {
    render: () => <ReadOnlyDrillIn />,
}
