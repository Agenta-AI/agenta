import {useEffect, useState} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import type {AgentSecretBinding} from "@agenta/entities/secret"
import {
    SecretRemoveDialog,
    secretAttachView,
    secretFormView,
    type SecretAttachViewParams,
} from "@agenta/entity-ui/secret"
import {userAtom} from "@agenta/shared/state"
import {DrillInUIProvider} from "@agenta/ui/drill-in"
import {
    useViewStack,
    ViewDrawerHost,
    ViewStackHost,
    type ViewDef,
    type ViewTarget,
} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the package barrel does not re-export the agent tab's sections and views.
import {AgentTemplateSectionList} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentTemplateSectionList"
import {PermissionPolicySelect} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/PermissionPolicySelect"
import {secretsSection} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/sections/SecretsSection"
import {
    advancedView,
    agentaToolsView,
} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/advancedViews"
import {permissionPolicyOptionsForEnum} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/permissionPolicy"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    CREDENTIALS,
    SECRETS_USER_ID,
    secretsQueries,
    secretsRevisionId,
} from "../../../fixtures/builderLayout/secrets"

const panel: AgentPanelApi = {
    content: "configuration",
    toggle: async () => true,
    close: async () => true,
    configTab: "agent",
    setConfigTab: () => undefined,
    wide: false,
    setWide: () => undefined,
    phone: false,
    available: {files: true, configuration: true, builder: false},
}

const drillInUI = {permissions: {canEditSecrets: true}}

type Frame =
    | "section"
    | "attach-everyone"
    | "attach-new"
    | "remove"
    | "permissions"
    | "advanced"
    | "agenta-tools"

/** Opens the frame's view the way a row or "+" does. */
const Open = <P,>({
    view,
    params,
    revisionId,
}: {
    view: ViewDef<P>
    params: P
    revisionId: string
}) => {
    const stack = useViewStack()
    useEffect(() => {
        const agent: ViewTarget = {kind: "agent_draft", revisionId}
        void stack.open(view, params, agent)
        // Open once on mount, like a click.
    }, [])
    return null
}

const PanelBox = ({children}: {children: React.ReactNode}) => (
    <AgentPanelContext.Provider value={panel}>
        <DrillInUIProvider components={drillInUI}>
            <div
                data-testid="agent-panel"
                className="ag-panel-raised flex h-[720px] flex-col border border-solid border-border"
                style={{width: 440}}
            >
                {children}
            </div>
        </DrillInUIProvider>
    </AgentPanelContext.Provider>
)

const PolicyFrame = () => {
    const [value, setValue] = useState("allow_reads")
    return (
        <div className="flex flex-col gap-2 p-4">
            <span className="text-sm font-medium">Permissions</span>
            <PermissionPolicySelect
                value={value}
                onChange={setValue}
                options={permissionPolicyOptionsForEnum(undefined).map((option) => ({
                    value: option.value,
                    title: option.label,
                    help: option.help,
                }))}
                aria-label="Policy"
            />
        </div>
    )
}

const SecretsFrame = ({frame, revisionId}: {frame: Frame; revisionId: string}) => {
    if (frame === "section") {
        const section = secretsSection({
            sectionIndicator: () => undefined,
            bindings: CREDENTIALS as AgentSecretBinding[],
            revisionId,
            canEditSecrets: true,
            openAttach: () => undefined,
        })
        return (
            <PanelBox>
                <div className="px-4">
                    <AgentTemplateSectionList sections={section ? [section] : []} />
                </div>
            </PanelBox>
        )
    }
    if (frame === "remove")
        return <SecretRemoveDialog onRemove={async () => undefined} onClose={() => undefined} />
    if (frame === "permissions")
        return (
            <PanelBox>
                <PolicyFrame />
            </PanelBox>
        )
    const open = (() => {
        if (frame === "attach-everyone")
            return {view: secretAttachView, params: {envVar: "BILLING_API_KEY"}}
        if (frame === "attach-new") return {view: secretAttachView, params: {}}
        if (frame === "advanced") return {view: advancedView, params: {}}
        return {view: agentaToolsView, params: {}}
    })() as {view: ViewDef<SecretAttachViewParams>; params: SecretAttachViewParams}
    return (
        <PanelBox>
            <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                <Open view={open.view} params={open.params} revisionId={revisionId} />
            </ViewStackHost>
        </PanelBox>
    )
}

const seeded = (opts: Parameters<typeof secretsQueries>[1] = {}) => ({
    agenta: {
        atoms: [[userAtom, {id: SECRETS_USER_ID, email: "story@agenta.ai"}]] as [
            typeof userAtom,
            unknown,
        ][],
        queries: (scope: StoryScope) => secretsQueries(scope, opts),
        args: (scope: StoryScope) => ({revisionId: secretsRevisionId(scope)}),
    },
})

const meta = {
    title: "BuilderLayout/secrets/Secrets, Permissions, Advanced",
    component: SecretsFrame,
    parameters: {layout: "padded", ...seeded()},
} satisfies Meta<typeof SecretsFrame>

export default meta
type Story = StoryObj<typeof meta>

/** F04 f3: Secrets, its own section after Skills; a missing secret shows "Needs setup". */
export const Section: Story = {args: {frame: "section", revisionId: ""}}

/** F04 f5: an attachment of a secret for everyone, opened from its row. */
export const AttachEveryone: Story = {args: {frame: "attach-everyone", revisionId: ""}}

/** F04 f7: no secret yet, so the view opens on "Create new secret" with "Who can use it". */
export const AttachNewSecret: Story = {
    args: {frame: "attach-new", revisionId: ""},
    parameters: seeded({credentials: [], projectSecrets: [], ownSecrets: []}),
}

/** F06 f3: the remove dialog. */
export const RemoveDialog: Story = {args: {frame: "remove", revisionId: ""}}

/** F04 f8: the policy select, inline in the Permissions section. */
export const Permissions: Story = {args: {frame: "permissions", revisionId: ""}}

/** F04 f9: Advanced lists its parts. */
export const Advanced: Story = {args: {frame: "advanced", revisionId: ""}}

/** F04 f10: Agenta tools, today's body with Cancel and Save. */
export const AgentaTools: Story = {args: {frame: "agenta-tools", revisionId: ""}}

/** Settings › Secrets: the one secret form, in a drawer with the target project. */
export const SettingsSecretForm: Story = {
    args: {frame: "section", revisionId: ""},
    render: () => (
        <ViewDrawerHost
            request={{
                view: secretFormView,
                params: {owners: ["user", "project"]},
                target: {kind: "project"},
            }}
            onClosed={() => undefined}
        />
    ),
}
