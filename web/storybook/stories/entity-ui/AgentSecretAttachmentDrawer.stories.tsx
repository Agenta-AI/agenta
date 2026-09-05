import {useState} from "react"

import {
    AgentSecretAttachmentDrawer,
    type AgentSecretAttachmentDrawerProps,
} from "@agenta/entity-ui/secret"
import {userAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

const USER_ID = "user-agent-secrets-story"
const SECRETS = [
    {
        id: "secret-github",
        type: "custom_secret",
        name: "GitHub token",
        slug: "github-token",
        format: "text",
        defaultEnvVar: "GITHUB_TOKEN",
        hasKey: true,
    },
    {
        id: "secret-npm",
        type: "custom_secret",
        name: "npm automation token",
        slug: "npm-automation-token",
        format: "text",
        defaultEnvVar: "NPM_TOKEN",
        hasKey: true,
    },
    {
        id: "secret-json",
        type: "custom_secret",
        name: "Service account JSON",
        slug: "service-account-json",
        format: "json",
        hasKey: true,
    },
]

const queries = (scope: StoryScope, secrets = SECRETS) => [
    [["vault", "secrets", USER_ID, scope.projectId], secrets] as [unknown[], unknown],
]

const seeded = (secrets = SECRETS) => ({
    agenta: {
        atoms: [[userAtom, {id: USER_ID, email: "story@agenta.ai"}]] as [
            typeof userAtom,
            unknown,
        ][],
        queries: (scope: StoryScope) => queries(scope, secrets),
    },
})

const baseProps: AgentSecretAttachmentDrawerProps = {
    open: true,
    onClose: () => undefined,
    target: {revisionId: "revision-story", label: "Repository assistant / Draft"},
    bindings: [],
    baseRevisionId: "revision-story",
    commitBinding: async () => ({revisionId: "revision-committed"}),
}

const meta = {
    title: "@agenta/entity-ui/Secret/AgentSecretAttachmentDrawer",
    component: AgentSecretAttachmentDrawer,
    parameters: {layout: "fullscreen", ...seeded()},
} satisfies Meta<typeof AgentSecretAttachmentDrawer>

export default meta
type Story = StoryObj<typeof meta>

/** Manual Settings entry. The vault picker contains text secrets only. */
export const ExistingSecret: Story = {args: baseProps}

/** Agent-request entry. Its requested variable wins over secret defaults and name derivation. */
export const RequestedSecret: Story = {
    args: {
        ...baseProps,
        request: {
            name: "GitHub token",
            envVar: "GITHUB_TOKEN",
            reason: "Authenticate the requested repository operation",
        },
    },
}

/** Create uses the same live SecretForm as Settings, including optional default metadata. */
export const CreateNew: Story = {
    args: {...baseProps, initialMode: "create", request: {name: "GitHub token"}},
}

/** JSON secrets remain in the vault but never appear in the agent attachment picker. */
export const EmptyTextVault: Story = {
    args: baseProps,
    parameters: seeded(SECRETS.filter((secret) => secret.format === "json")),
}

/** Existing binding edit. The attachment env is a user override and stays stable. */
export const EditBinding: Story = {
    args: {
        ...baseProps,
        bindings: [{secret: {slug: "github-token"}, binding: {type: "env", name: "GH_AUTH_TOKEN"}}],
        editingBinding: {
            index: 0,
            value: {
                secret: {slug: "github-token"},
                binding: {type: "env", name: "GH_AUTH_TOKEN"},
            },
        },
    },
}

/** An unrelated draft must be resolved by the host editor before attachment. */
export const UnsavedAgentChanges: Story = {args: {...baseProps, dirty: true}}

function RetryableFailureStory() {
    const [attempts, setAttempts] = useState(0)
    return (
        <AgentSecretAttachmentDrawer
            {...baseProps}
            commitBinding={async () => {
                setAttempts((count) => count + 1)
                throw new Error(
                    `The agent revision changed while this drawer was open (attempt ${attempts + 1}).`,
                )
            }}
        />
    )
}

/** Select a secret and Attach. The selected reference remains available for a retry. */
export const AttachmentConflict: Story = {
    args: baseProps,
    render: () => <RetryableFailureStory />,
}

function ToggleStory() {
    const [open, setOpen] = useState(false)
    return (
        <div className="p-6">
            <Button onClick={() => setOpen(true)}>Attach secret</Button>
            <AgentSecretAttachmentDrawer
                {...baseProps}
                open={open}
                onClose={() => setOpen(false)}
            />
        </div>
    )
}

/** Native drawer lifecycle, including its real close transition. */
export const Closed: Story = {args: baseProps, render: () => <ToggleStory />}
