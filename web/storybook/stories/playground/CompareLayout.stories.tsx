import {useEffect, useState} from "react"

import {
    createLocalDraftFromWorkflowRevision,
    workflowFlagsSchema,
    workflowMolecule,
    type Workflow,
} from "@agenta/entities/workflow"
import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {playgroundController} from "@agenta/playground"
import {CompareLayout} from "@agenta/playground-ui/panels/compare"
import {ConfigPanel} from "@agenta/playground-ui/panels/config"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore, useAtomValue} from "jotai"
import {expect, userEvent, within} from "storybook/test"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {
    variantNameCellQueries,
    workflowIds,
    workflowRevision,
    type WorkflowIds,
} from "../../fixtures/workflow"

import {withAppBoxSizing} from "./borderBox"
import {promptRevision, selectRevision} from "./playgroundFixtures"

/** A chat app's revision, with a variable in its system message. */
const chatRevision = (ids: WorkflowIds): Workflow =>
    workflowRevision(ids, {
        slug: "trip-planner-v2",
        name: "default",
        version: 2,
        message: "Plan trips",
        flags: workflowFlagsSchema.parse({is_application: true, is_chat: true}),
        data: {
            uri: "agenta:builtin:chat:v0",
            parameters: {
                prompt: {
                    messages: [{role: "system", content: "You help {{name}} plan trips."}],
                    llm_config: {model: "gpt-4o-mini", temperature: 0.2},
                },
            },
        },
    })

/** The second revision on screen: an older version of the same variant, with another model. */
const secondRevision = (base: Workflow, ids: WorkflowIds): Workflow => {
    const parameters = base.data?.parameters as {prompt: Record<string, unknown>}
    return workflowRevision(ids, {
        ...base,
        id: `${ids.revisionId}-older`,
        version: (base.version ?? 2) - 1,
        data: {
            ...base.data,
            parameters: {prompt: {...parameters.prompt, llm_config: {model: "gpt-4o"}}},
        },
    })
}

const queries = (chat: boolean) => (scope: StoryScope) => {
    const ids = workflowIds(scope)
    const make = chat ? chatRevision : promptRevision
    const second = secondRevision(make(ids), ids)
    return [
        ...variantNameCellQueries(scope, {
            revision: make,
            variantNames: ["default"],
            deployedTo: ["production"],
        }),
        [["workflows", "revision", second.id, ids.projectId], second] as [string[], unknown],
    ]
}

const store = getDefaultStore()

/**
 * The /m playground's compare view: the variant column and one config column per revision on
 * top, the inputs and one output column per revision below. With three columns the third is a
 * local draft copied from the first revision. Data-connected: revisions come from the seeded
 * query cache.
 */
const Demo = ({revisionId, columns}: {revisionId: string; columns: 2 | 3}) => {
    const [viewMode, setViewMode] = useState<ConfigViewMode>("form")
    const loaded = Boolean(useAtomValue(workflowMolecule.selectors.data(revisionId)))
    const revisionIds = useAtomValue(playgroundController.selectors.entityIds())

    useEffect(() => {
        if (!loaded) return
        selectRevision(revisionId)
        const copy = columns === 3 ? createLocalDraftFromWorkflowRevision(revisionId) : null
        store.set(playgroundController.actions.setEntityIds, [
            revisionId,
            `${revisionId}-older`,
            ...(copy ? [copy] : []),
        ])
    }, [columns, loaded, revisionId])

    return (
        <div className="flex h-[860px] w-full flex-col bg-background text-foreground">
            {revisionIds.length > 1 ? (
                <CompareLayout
                    revisionIds={revisionIds}
                    onClose={(id) => store.set(playgroundController.actions.removeEntity, id)}
                    renderConfig={(id) => (
                        <ConfigPanel
                            revisionId={id}
                            viewMode={viewMode}
                            onViewModeChange={setViewMode}
                        />
                    )}
                />
            ) : null}
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/CompareLayout",
    component: Demo,
    decorators: [withAppBoxSizing],
    parameters: {
        layout: "fullscreen",
        agenta: {
            queries: queries(false),
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

const ready = async (canvasElement: HTMLElement) => {
    await within(canvasElement).findByText("Variants")
    await within(canvasElement).findAllByText("Input")
}

/** A completion app: the latest revision beside an older one. */
export const CompletionTwoColumns: Story = {
    args: {revisionId: "", columns: 2},
    play: async ({canvasElement}) => ready(canvasElement),
}

/** A completion app with a third column: a local draft of the first revision. */
export const CompletionThreeColumns: Story = {
    args: {revisionId: "", columns: 3},
    play: async ({canvasElement}) => ready(canvasElement),
}

/** A chat app: the input column holds the variables and the user message, once. */
export const ChatTwoColumns: Story = {
    args: {revisionId: "", columns: 2},
    parameters: {agenta: {queries: queries(true)}},
    play: async ({canvasElement}) => ready(canvasElement),
}

export const ChatThreeColumns: Story = {
    args: {revisionId: "", columns: 3},
    parameters: {agenta: {queries: queries(true)}},
    play: async ({canvasElement}) => ready(canvasElement),
}

const fitsTheScreen = (canvasElement: HTMLElement) => {
    const root = canvasElement.ownerDocument.documentElement
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
    const layout = canvasElement.querySelector("[data-testid=compare-layout]")
    for (const area of layout?.children ?? []) {
        expect(area.scrollWidth).toBeLessThanOrEqual(area.clientWidth + 1)
    }
}

/** On a phone the config columns stack, one under the other: no sideways scroll. */
export const PhoneConfiguration: Story = {
    args: {revisionId: "", columns: 2},
    parameters: {viewport: {defaultViewport: "mobile1"}},
    play: async ({canvasElement}) => {
        await ready(canvasElement)
        fitsTheScreen(canvasElement)
    },
}

/** On a phone the input column and each output stack, each output under its revision's name. */
export const PhoneGenerations: Story = {
    args: {revisionId: "", columns: 2},
    parameters: {viewport: {defaultViewport: "mobile1"}},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await ready(canvasElement)
        await userEvent.click((await canvas.findAllByText("Generations"))[0])
        fitsTheScreen(canvasElement)
    },
}
