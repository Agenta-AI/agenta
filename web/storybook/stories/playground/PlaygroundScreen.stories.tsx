import {useState} from "react"

import {projectPermissionQueryKey} from "@agenta/entities/access"
import {workflowMolecule} from "@agenta/entities/workflow"
import type {Meta, StoryObj} from "@storybook/nextjs"
import type {QueryKey} from "@tanstack/react-query"
import {userEvent, within} from "storybook/test"

import {PlaygroundWorkspace} from "../../../mobile/src/features/playground/PlaygroundWorkspace"
import {PlaygroundLoadError} from "../../../mobile/src/features/playground/states/PlaygroundLoadError"
import {PlaygroundSkeleton} from "../../../mobile/src/features/playground/states/PlaygroundSkeleton"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {workflowIds} from "../../fixtures/workflow"

import {promptRevisionQueries, selectRevision} from "./playgroundFixtures"

/**
 * The /m prompt playground page: the top bar, the config pane and the run pane (test cases, run and output). Below `md` one pane shows at a time, picked with Configuration / Generations.
 * The route's data lifecycle has unit tests; the loaded page here reads a seeded revision.
 */
const Demo = ({
    projectId,
    appId,
    revisionId,
    withDraftEdit = false,
}: {
    projectId: string
    appId: string
    revisionId: string
    withDraftEdit?: boolean
}) => {
    useState(() => {
        selectRevision(revisionId)
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
                appId={appId}
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
            queries: (scope: StoryScope) => [
                ...promptRevisionQueries(scope),
                // An editor who may deploy: the bar's Commit, Deploy and menu are enabled.
                [projectPermissionQueryKey(scope.projectId, "edit_workflows"), true] as [
                    QueryKey,
                    unknown,
                ],
                [projectPermissionQueryKey(scope.projectId, "deploy_environments"), true] as [
                    QueryKey,
                    unknown,
                ],
            ],
            args: (scope: StoryScope) => ({
                projectId: scope.projectId,
                appId: workflowIds(scope).workflowId,
                revisionId: workflowIds(scope).revisionId,
            }),
        },
    },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

/** The app or its revision is still loading: the final layout, in skeleton. */
export const Loading: Story = {
    args: {projectId: "", appId: "", revisionId: ""},
    render: () => (
        <div className="h-screen bg-background text-foreground">
            <PlaygroundSkeleton />
        </div>
    ),
}

/** A completion prompt app with its latest revision selected. */
export const Ready: Story = {
    args: {projectId: "", appId: "", revisionId: ""},
    play: async ({canvasElement}) => {
        await within(canvasElement).findByText("Capital finder")
    },
}

/** On a phone: the Generations side of the switch. On a wide screen both panes show. */
export const ReadyPhone: Story = {
    args: {projectId: "", appId: "", revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await canvas.findByText("Capital finder")
        const generations = canvas.queryByRole("radio", {name: "Generations"})
        if (generations) generations.click()
    },
}

/** The app or a revision failed to load. Try again refetches; it keeps local drafts. */
export const LoadError: Story = {
    args: {projectId: "", appId: "", revisionId: ""},
    render: () => (
        <div className="h-screen bg-background text-foreground">
            <PlaygroundLoadError onRetry={() => undefined} />
        </div>
    ),
}

/** The revision has an unsaved edit: the header shows the Draft tag. */
export const Dirty: Story = {
    args: {projectId: "", appId: "", revisionId: "", withDraftEdit: true},
    play: async ({canvasElement}) => {
        await within(canvasElement).findByText("Draft")
    },
}

/** The revision switcher open: the app's variants and their revisions. */
export const SwitcherOpen: Story = {
    args: {projectId: "", appId: "", revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: "Switch revision"}))
    },
}

/** The revision menu open on a revision with unsaved edits: Revert Changes is available. */
export const MenuOpen: Story = {
    args: {projectId: "", appId: "", revisionId: "", withDraftEdit: true},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: "Revision actions"}))
    },
}

/** The shared commit dialog, opened from Commit on a revision with unsaved edits. */
export const CommitOpen: Story = {
    args: {projectId: "", appId: "", revisionId: "", withDraftEdit: true},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: "Commit"}))
    },
}
