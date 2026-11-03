import {useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {within} from "storybook/test"

import {PlaygroundWorkspace} from "../../../mobile/src/features/playground/PlaygroundWorkspace"
import {PlaygroundLoadError} from "../../../mobile/src/features/playground/states/PlaygroundLoadError"
import {PlaygroundSkeleton} from "../../../mobile/src/features/playground/states/PlaygroundSkeleton"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {workflowIds} from "../../fixtures/workflow"

import {promptRevisionQueries} from "./playgroundFixtures"

/**
 * The /m prompt playground page: the top bar, the config pane and the run pane (a placeholder
 * until runs land). Below `md` one pane shows at a time, picked with Configuration / Generations.
 * The route's data lifecycle has unit tests; the loaded page here reads a seeded revision.
 */
const Demo = ({
    projectId,
    revisionId,
    withDraftEdit = false,
}: {
    projectId: string
    revisionId: string
    withDraftEdit?: boolean
}) => {
    useState(() => {
        if (!withDraftEdit) return
        // An unsaved edit to the prompt: the header shows the Draft tag.
        const revision = workflowMolecule.get.data(revisionId)
        workflowMolecule.set.update(revisionId, {
            data: {
                ...revision?.data,
                parameters: {
                    prompt: {
                        messages: [
                            {role: "system", content: "Answer with the capital and the country."},
                            {role: "user", content: "What is the capital of {{country}}?"},
                        ],
                        llm_config: {model: "gpt-4o-mini", temperature: 0.2},
                    },
                },
            },
        })
    })
    return (
        <div className="h-screen bg-background text-foreground">
            <PlaygroundWorkspace
                workspaceId="ws-story"
                projectId={projectId}
                appName="Capital finder"
                revisionId={revisionId}
                onWorkflowRevisionCommitted={() => undefined}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/PlaygroundScreen",
    component: Demo,
    parameters: {
        layout: "fullscreen",
        agenta: {
            queries: (scope: StoryScope) => promptRevisionQueries(scope),
            args: (scope: StoryScope) => ({
                projectId: scope.projectId,
                revisionId: workflowIds(scope).revisionId,
            }),
        },
    },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

/** The app or its revision is still loading: the final layout, in skeleton. */
export const Loading: Story = {
    args: {projectId: "", revisionId: ""},
    render: () => (
        <div className="h-screen bg-background text-foreground">
            <PlaygroundSkeleton />
        </div>
    ),
}

/** A completion prompt app with its latest revision selected. */
export const Ready: Story = {
    args: {projectId: "", revisionId: ""},
    play: async ({canvasElement}) => {
        await within(canvasElement).findByText("Capital finder")
    },
}

/** On a phone: the Generations side of the switch. On a wide screen both panes show. */
export const ReadyPhone: Story = {
    args: {projectId: "", revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await canvas.findByText("Capital finder")
        const generations = canvas.queryByRole("radio", {name: "Generations"})
        if (generations) generations.click()
    },
}

/** The app or a revision failed to load. Try again refetches; it keeps local drafts. */
export const LoadError: Story = {
    args: {projectId: "", revisionId: ""},
    render: () => (
        <div className="h-screen bg-background text-foreground">
            <PlaygroundLoadError onRetry={() => undefined} />
        </div>
    ),
}

/** The revision has an unsaved edit: the header shows the Draft tag. */
export const Dirty: Story = {
    args: {projectId: "", revisionId: "", withDraftEdit: true},
    play: async ({canvasElement}) => {
        await within(canvasElement).findByText("Draft")
    },
}
