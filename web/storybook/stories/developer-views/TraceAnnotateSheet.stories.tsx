import {useEffect, useState, type ReactNode} from "react"

import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {axios} from "@agenta/shared/api"
import {activeUserIdAtom} from "@agenta/shared/state"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {TraceAnnotateSheet} from "../../../mobile/src/features/observability/annotate/TraceAnnotateSheet"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

const USER = "user-alex"

const revision = (
    slug: string,
    name: string,
    properties: Record<string, unknown>,
    required: string[] = [],
) => ({
    id: `rev-${slug}`,
    workflow_id: `wf-${slug}`,
    slug,
    name,
    description: `${name} of the reply`,
    flags: {is_evaluator: true, is_feedback: true},
    data: {schemas: {outputs: {type: "object", properties, required}}},
})

const REVISIONS = {
    tone: revision("tone", "Tone", {friendly: {type: "boolean"}}),
    quality: revision(
        "quality",
        "Quality",
        {
            rating: {type: "integer", minimum: 1, maximum: 5},
            confidence: {type: "number"},
            comment: {type: "string"},
            labels: {type: "array", items: {type: "string", enum: ["clear", "short", "polite"]}},
            verdict: {type: ["string", "null"], enum: ["pass", "fail", null]},
        },
        ["rating"],
    ),
}

type Slug = keyof typeof REVISIONS

const fixtures =
    (slugs: Slug[] = ["tone", "quality"]) =>
    (scope: StoryScope) => [
        [
            ["workflows", "evaluators", "list", scope.projectId],
            {
                count: slugs.length,
                refs: slugs.map((slug) => ({
                    id: `wf-${slug}`,
                    slug,
                    name: REVISIONS[slug].name,
                    description: REVISIONS[slug].description,
                })),
            },
        ] as [unknown[], unknown],
        ...slugs.map(
            (slug) =>
                [
                    ["workflows", "latestRevision", `wf-${slug}`, scope.projectId],
                    REVISIONS[slug],
                ] as [unknown[], unknown],
        ),
    ]

const ownAnnotation = (slug: Slug, outputs: Record<string, unknown>): AnnotationDto =>
    ({
        trace_id: `ann-${slug}`,
        span_id: `ann-span-${slug}`,
        data: {outputs: {metrics: outputs}},
        references: {evaluator: {id: `wf-${slug}`, slug}},
        links: {invocation: {trace_id: "trace-1", span_id: "span-1"}},
        channel: "web",
        kind: "adhoc",
        origin: "human",
        meta: {name: REVISIONS[slug].name, description: "", tags: Object.keys(outputs)},
        createdById: USER,
        created_at: "2026-11-01T10:00:00Z",
    }) as AnnotationDto

type ApiMode = "ok" | "hang" | "fail"
type AdapterConfig = Parameters<
    Extract<NonNullable<typeof axios.defaults.adapter>, (...args: never[]) => unknown>
>[0]

/**
 * Answers the API calls of the sheet: the read of the user's stored annotations with the story's
 * own annotations, and a save with success, never (a save in flight) or a server error.
 */
const WithApi = ({
    mode,
    annotations,
    children,
}: {
    mode: ApiMode
    annotations: readonly AnnotationDto[]
    children: ReactNode
}) => {
    useState(() => {
        const stored = annotations.map((item) => ({
            ...item,
            data: {outputs: (item.data.outputs as {metrics?: Record<string, unknown>}).metrics},
        }))
        const answer = (config: AdapterConfig, data: unknown) =>
            Promise.resolve({data, status: 200, statusText: "OK", headers: {}, config})
        const reject = (config: AdapterConfig) =>
            Promise.reject(
                Object.assign(new Error("Request failed with status code 500"), {
                    config,
                    response: {status: 500, data: {detail: "Server error"}},
                }),
            )
        axios.defaults.adapter = (config) => {
            if (config.url?.endsWith("/simple/traces/query")) {
                return answer(config, {count: stored.length, traces: stored})
            }
            if (mode === "hang") return new Promise(() => undefined)
            if (mode === "fail") return reject(config)
            return answer(config, {
                trace: {trace_id: "ann-new", span_id: "ann-span-new", data: {outputs: {}}},
            })
        }
        return null
    })
    useEffect(
        () => () => {
            axios.defaults.adapter = undefined
        },
        [],
    )
    return children
}

const meta = {
    title: "@agenta/mobile/Developer/Observability/TraceAnnotateSheet",
    component: TraceAnnotateSheet,
    parameters: {
        layout: "fullscreen",
        agenta: {queries: fixtures(), atoms: [[activeUserIdAtom, USER]]},
        docs: {
            description: {
                component:
                    "The trace annotate sheet from web/mobile, over the real form hook with seeded evaluator queries.",
            },
        },
    },
    args: {traceId: "trace-1", spanId: "span-1", annotations: [], onClose: () => undefined},
    decorators: [
        (Story, {args, parameters}) => (
            <WithApi
                mode={(parameters as {api?: ApiMode}).api ?? "ok"}
                annotations={args.annotations}
            >
                <Story />
            </WithApi>
        ),
    ],
} satisfies Meta<typeof TraceAnnotateSheet>

export default meta
type Story = StoryObj<typeof meta>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

const pickTone = async (canvasElement: HTMLElement) => {
    const screen = body(canvasElement)
    await userEvent.click((await screen.findAllByRole("button", {name: "Add Evaluator"}))[0])
    await userEvent.click(await screen.findByRole("checkbox", {name: "Tone"}))
    await userEvent.click(screen.getByRole("button", {name: "Annotate"}))
    await userEvent.click(await screen.findByRole("radio", {name: "True"}))
    return screen
}

export const Empty: Story = {
    play: async ({canvasElement}) => {
        await expect(
            await body(canvasElement).findByText("There are no available annotations"),
        ).toBeVisible()
    },
}

export const Filled: Story = {
    play: async ({canvasElement}) => {
        const screen = await pickTone(canvasElement)
        await expect(screen.getByRole("button", {name: "Save"})).toBeEnabled()
    },
}

export const EditExisting: Story = {
    args: {
        annotations: [
            ownAnnotation("quality", {
                rating: 4,
                confidence: 0.8,
                comment: "Clear and polite",
                labels: ["clear", "polite"],
                verdict: "pass",
            }),
            ownAnnotation("tone", {friendly: true}),
        ],
    },
    play: async ({canvasElement}) => {
        const screen = body(canvasElement)
        await expect(await screen.findByDisplayValue("Clear and polite")).toBeVisible()
        await expect(screen.getByRole("button", {name: "Save"})).toBeDisabled()
    },
}

export const RequiredError: Story = {
    play: async ({canvasElement}) => {
        const screen = body(canvasElement)
        await userEvent.click((await screen.findAllByRole("button", {name: "Add Evaluator"}))[0])
        await userEvent.click(await screen.findByRole("checkbox", {name: "Quality"}))
        await userEvent.click(screen.getByRole("button", {name: "Annotate"}))
        await userEvent.type(await screen.findByLabelText("comment"), "Too short")
        await userEvent.click(screen.getByRole("button", {name: "Save"}))
        await expect(await screen.findByText("Required")).toBeVisible()
    },
}

export const Saving: Story = {
    parameters: {api: "hang"},
    play: async ({canvasElement}) => {
        const screen = await pickTone(canvasElement)
        await userEvent.click(screen.getByRole("button", {name: "Save"}))
        await expect(screen.getByRole("button", {name: "Save"})).toBeDisabled()
    },
}

export const SaveError: Story = {
    parameters: {api: "fail"},
    play: async ({canvasElement}) => {
        const screen = await pickTone(canvasElement)
        await userEvent.click(screen.getByRole("button", {name: "Save"}))
        await expect(await screen.findByText("Failed to update annotations")).toBeVisible()
        await expect(screen.getByRole("button", {name: "Save"})).toBeEnabled()
    },
}

export const SelectEvaluators: Story = {
    args: {annotations: [ownAnnotation("tone", {friendly: false})]},
    play: async ({canvasElement}) => {
        const screen = body(canvasElement)
        await userEvent.click((await screen.findAllByRole("button", {name: "Add Evaluator"}))[0])
        await expect(await screen.findByRole("checkbox", {name: "Tone"})).toBeDisabled()
    },
}

export const SelectEvaluatorsEmpty: Story = {
    parameters: {agenta: {queries: fixtures([])}},
    play: async ({canvasElement}) => {
        const screen = body(canvasElement)
        await userEvent.click((await screen.findAllByRole("button", {name: "Add Evaluator"}))[0])
        await expect(await screen.findByText("There are no available evaluators")).toBeVisible()
    },
}
