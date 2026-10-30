import {resolvedWorkflowRevisionFamilyKey} from "@agenta/entities/workflow"
import {userAtom} from "@agenta/shared/state"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the storybook package does not depend on @agenta/automation-ui.
import type {Automation} from "../../../packages/agenta-automation-ui/src/automationModel"
import {AutomationRunPersonNotice} from "../../../packages/agenta-automation-ui/src/AutomationRunPersonNotice"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {integrationQueries} from "../../fixtures/gatewayIntegration"

/**
 * Beside an automation's save bar: saving makes the viewer the person it runs as, and the agent
 * uses each person's own accounts for some items. It lists what the viewer has not set up. The
 * save is never blocked.
 */
const meta = {
    title: "@agenta/automation-ui/AutomationRunPersonNotice",
    component: AutomationRunPersonNotice,
    parameters: {layout: "padded"},
} satisfies Meta<typeof AutomationRunPersonNotice>

export default meta
type Story = StoryObj<typeof AutomationRunPersonNotice>

const VIEWER = "user-viewer-story"
const AGENT = "0193a000-0000-7000-8000-000000000003"
const REVISION = "0193a000-0000-7000-8000-000000000004"

const automation = {
    id: "trigger-1",
    kind: "schedule",
    name: "Weekly release notes",
    description: "",
    agentId: AGENT,
    isActive: true,
    cron: "0 9 * * 1",
    eventKey: null,
    connectionId: null,
    updatedAt: null,
    raw: {
        id: "trigger-1",
        principal: {kind: "human", id: "user-alice"},
        data: {references: {workflow: {id: AGENT}}, schedule: "0 9 * * 1"},
    },
} as unknown as Automation

const seeded = (missing: boolean) => ({
    agenta: {
        atoms: [[userAtom, {id: VIEWER, email: "bob@acme.com"}]] as [typeof userAtom, unknown][],
        queries: (scope: StoryScope) =>
            [
                ...integrationQueries(scope, {connections: []}),
                [["tools", "connections", "user", VIEWER, scope.projectId], []],
                [
                    [
                        "workflows",
                        "resolved-revision",
                        scope.projectId,
                        resolvedWorkflowRevisionFamilyKey({workflowId: AGENT}),
                    ],
                    {
                        id: REVISION,
                        workflowId: AGENT,
                        parameters: {
                            agent: {
                                tools: [
                                    {
                                        type: "gateway_connection",
                                        connection: {
                                            provider: "composio",
                                            integration: "github",
                                            account_source: "user",
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
                [
                    ["workflows", "requirements", scope.projectId, REVISION],
                    {
                        count: missing ? 1 : 0,
                        status: missing ? "needs_setup" : "ready",
                        requirements: missing
                            ? [
                                  {
                                      key: "app_connection:user/github",
                                      kind: "app_connection",
                                      account_source: "user",
                                      label: "github",
                                      reference: {provider: "composio", integration: "github"},
                                      paths: ["agent.tools[0].connection"],
                                      reason: "needs_personal_account",
                                      blocks_run: false,
                                      fix: {can_connect: true, candidates: 0},
                                  },
                              ]
                            : [],
                    },
                ],
            ] as [unknown[], unknown][],
    },
})

/** Someone else runs it today, and the viewer has not connected GitHub. */
export const WithMissingItems: Story = {
    parameters: seeded(true),
    render: () => (
        <div className="w-[640px]">
            <AutomationRunPersonNotice automation={automation} draftAgentId={AGENT} dirty />
        </div>
    ),
}

/** Everything is set up for the viewer: the notice only says who it will run as. */
export const AllSetUp: Story = {
    parameters: seeded(false),
    render: () => (
        <div className="w-[640px]">
            <AutomationRunPersonNotice automation={automation} draftAgentId={AGENT} dirty />
        </div>
    ),
}
