import {useState, type ReactNode} from "react"

import {McpServerFormView} from "@agenta/entity-ui/drill-in"
import {userAtom} from "@agenta/shared/state"
import type {Meta, StoryObj} from "@storybook/nextjs"

// McpServerFormView — structured editor for one external HTTP MCP server (the Form side of
// the MCP `ConfigItemDrawer`). It is the ONE container in this chunk: it reads
// `customNamedSecretsAtom` for the project-secret picker, so the secrets fixture is seeded
// through the data seam (userAtom + the vault query key that atom derives from) rather than
// prop-drilled.
//
// Fixture keys mirror `vaultSecretsQueryAtom` (agenta-entities/src/secret/state/atoms.ts:112):
// ["vault","secrets", user.id, projectId], gated on `enabled: !!user && !!projectId` — hence
// the `userAtom` seed. The rows are the transformed `LlmProvider` shape the query resolves to.
const meta = {
    title: "@agenta/entity-ui/DrillIn/McpServerFormView",
    component: McpServerFormView,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Server name / MCP URL / authentication. Picking `Secret header` reveals the header-name field and the project-secret picker (atom-backed). The picker pins a `Create secret` action under its options (present whether the list is empty or full) that opens the shared `CreateSecretDrawer`; on save the new secret is written to the project vault and selected here.",
            },
        },
    },
} satisfies Meta<typeof McpServerFormView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const SECRETS = [
    {id: "sec-1", type: "custom_secret", name: "Exa API key", slug: "exa-api-key"},
    {id: "sec-2", type: "custom_secret", name: "Serper key", slug: "serper-key"},
]

const secretQueries = (scope: {projectId: string}) => [
    [["vault", "secrets", "user-mcp-story", scope.projectId], SECRETS] as [unknown[], unknown],
]

const seed = {
    agenta: {
        atoms: [[userAtom, {id: "user-mcp-story", email: "story@agenta.ai"}]] as [
            typeof userAtom,
            unknown,
        ][],
        queries: secretQueries,
    },
}

const NONE_SERVER = {
    name: "exa",
    connection: {type: "http", url: "https://mcp.exa.ai/mcp", credentials: {type: "none"}},
}

const SECRET_SERVER = {
    name: "exa",
    connection: {
        type: "http",
        url: "https://mcp.exa.ai/mcp",
        credentials: {type: "header_secret_refs", headers: {"x-api-key": "exa-api-key"}},
    },
}

const INVALID_SERVER = {name: "not a valid name!", connection: {type: "http", url: ""}}

// Secret-header auth with an invalid name.
const INVALID_SECRET_SERVER = {
    ...SECRET_SERVER,
    name: "not a valid name!",
    connection: {...SECRET_SERVER.connection, url: ""},
}

function Live({value}: {value: Record<string, unknown>}) {
    const [current, setCurrent] = useState(value)
    return (
        <div className="max-w-[560px]">
            <McpServerFormView value={current} onChange={setCurrent} />
        </div>
    )
}

/** No authentication — name + URL only. */
export const NoAuth: Story = {
    args: {value: NONE_SERVER, onChange: noop},
    parameters: seed,
    render: () => <Live value={NONE_SERVER} />,
}

/** Secret header — reveals the header-name field and the atom-backed project-secret picker. */
export const SecretHeader: Story = {
    args: {value: SECRET_SERVER, onChange: noop},
    parameters: seed,
    render: () => <Live value={SECRET_SERVER} />,
}

/** No project secrets in the vault — the picker's empty branch. */
export const NoProjectSecrets: Story = {
    args: {value: SECRET_SERVER, onChange: noop},
    parameters: {
        agenta: {
            atoms: seed.agenta.atoms,
            queries: (scope: {projectId: string}) => [
                [["vault", "secrets", "user-mcp-story", scope.projectId], []] as [
                    unknown[],
                    unknown,
                ],
            ],
        },
    },
    render: () => <Live value={SECRET_SERVER} />,
}

/** Invalid server name — the error skin plus the inline hint. */
export const InvalidName: Story = {
    args: {value: INVALID_SERVER, onChange: noop},
    parameters: seed,
    render: () => <Live value={INVALID_SERVER} />,
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <div className="flex-1">{children}</div>
        </div>
    </div>
)

export const Variants: Story = {
    args: {value: SECRET_SERVER, onChange: noop},
    parameters: seed,
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row label="secret header">
                <McpServerFormView value={SECRET_SERVER} onChange={noop} />
            </Row>
            <Row label="invalid name">
                <McpServerFormView value={INVALID_SECRET_SERVER} onChange={noop} />
            </Row>
        </div>
    ),
}
