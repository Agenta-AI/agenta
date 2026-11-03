import {useState} from "react"

import {createLocalDraftFromWorkflowRevision} from "@agenta/entities/workflow"
import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {pendingHydrationsAtom} from "@agenta/playground"
import {ConfigPanel} from "@agenta/playground-ui/panels/config"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore} from "jotai"
import {expect, userEvent, waitFor, within} from "storybook/test"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {workflowIds} from "../../fixtures/workflow"

import {promptRevisionQueries} from "./playgroundFixtures"

/**
 * One revision's config in the /m prompt playground: the header bar (revision, version,
 * environments, Form/JSON/YAML) and the shared config editor. Data-connected: the revision comes
 * from the seeded query cache.
 */
const Demo = ({
    revisionId,
    initialViewMode = "form",
    asLocalDraft = false,
    hydrating = false,
}: {
    revisionId: string
    initialViewMode?: ConfigViewMode
    asLocalDraft?: boolean
    hydrating?: boolean
}) => {
    const [viewMode, setViewMode] = useState<ConfigViewMode>(initialViewMode)
    const [shownId] = useState(() => {
        if (hydrating) {
            // A shared link with draft edits still to apply to this revision.
            getDefaultStore().set(
                pendingHydrationsAtom,
                new Map([
                    [
                        `draft-${revisionId}`,
                        {
                            draftKey: `draft-${revisionId}`,
                            sourceRevisionId: revisionId,
                            runnableType: "workflow" as const,
                            patch: {parameters: {}},
                        },
                    ],
                ]),
            )
        }
        return asLocalDraft
            ? (createLocalDraftFromWorkflowRevision(revisionId) ?? revisionId)
            : revisionId
    })
    return (
        <div className="h-[640px] w-full max-w-[720px] overflow-y-auto border border-border bg-background text-foreground">
            <ConfigPanel revisionId={shownId} viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/ConfigPanel",
    component: Demo,
    parameters: {
        layout: "padded",
        agenta: {
            queries: (scope: StoryScope) => promptRevisionQueries(scope),
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

/** A saved revision: variant name, version, its environment, and the form editor. */
export const Saved: Story = {
    args: {revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await canvas.findByText("v3")
        await expect(canvas.getByLabelText("Config view")).toHaveTextContent("Form")
    },
}

/** A local copy of the revision: the Draft tag and the revision it came from. */
export const LocalDraft: Story = {
    args: {revisionId: "", asLocalDraft: true},
    play: async ({canvasElement}) => {
        await within(canvasElement).findByText("from default v3")
    },
}

/** Draft edits from a shared link are still being applied: the editor waits. */
export const Hydrating: Story = {
    args: {revisionId: "", hydrating: true},
    play: async ({canvasElement}) => {
        await within(canvasElement).findByTestId("config-panel-skeleton")
    },
}

/** The JSON view, picked from the header switch. */
export const JsonView: Story = {
    args: {revisionId: ""},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByLabelText("Config view"))
        await userEvent.click(await within(document.body).findByRole("option", {name: "JSON"}))
        await waitFor(() => expect(canvas.getByLabelText("Config view")).toHaveTextContent("JSON"))
    },
}
