import {useState, type ReactNode} from "react"

import {RailField, railInfoLabel} from "@agenta/entity-ui/drawers/shared"
import {McpServerFormView} from "@agenta/entity-ui/drill-in"
import {userAtom} from "@agenta/shared/state"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Input as AntInput, Select as AntSelect, Tag as AntTag} from "antd"

// McpServerFormView — structured editor for one external HTTP MCP server (the Form side of
// the MCP `ConfigItemDrawer`). It is the ONE container in this chunk: it reads
// `customNamedSecretsAtom` for the project-secret picker, so the secrets fixture is seeded
// through the data seam (userAtom + the vault query key that atom derives from) rather than
// prop-drilled.
//
// Fixture keys mirror `vaultSecretsQueryAtom` (agenta-entities/src/secret/state/atoms.ts:112):
// ["vault","secrets", user.id, projectId], gated on `enabled: !!user && !!projectId` — hence
// the `userAtom` seed. The rows are the transformed `LlmProvider` shape the query resolves to.
//
// antd swaps: `Input status="error"` → `Input` + `aria-invalid`; `Select options/onChange` →
// Radix `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` (`notFoundContent` has no
// prop — the empty branch renders inside `SelectContent`); `Tag` → `Badge`.
const meta = {
    title: "@agenta/entity-ui/DrillIn/McpServerFormView",
    component: McpServerFormView,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Server name / MCP URL / authentication. Picking `Secret header` reveals the header-name field and the project-secret picker (atom-backed).",
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

// Same field set as the antd replay below (secret-header auth), with an invalid name.
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
// Parity: the pre-migration form beside the migrated one
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[8rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

/** Pre-migration form body, verbatim from feat/storybook-data-seam. */
const AntdForm = ({invalid}: {invalid?: boolean}) => (
    <div className="flex flex-col gap-3">
        <RailField label="Server name">
            <AntInput
                value={invalid ? "not a valid name!" : "exa"}
                placeholder="exa"
                status={invalid ? "error" : undefined}
                readOnly
            />
            {invalid ? (
                <span className="mt-1 text-xs text-[var(--ag-colorError)]">
                    Use only letters, numbers, dots, hyphens, or underscores.
                </span>
            ) : null}
        </RailField>

        <RailField label="MCP URL" align="center">
            <AntInput
                value={invalid ? "" : "https://mcp.exa.ai/mcp"}
                placeholder="https://example.com/mcp"
                readOnly
            />
        </RailField>

        <RailField label="Authentication" align="center">
            <AntSelect
                className="w-full"
                value="header_secret_refs"
                open={false}
                options={[
                    {label: "None", value: "none"},
                    {label: "Secret header", value: "header_secret_refs"},
                    {
                        label: (
                            <span className="flex items-center justify-between gap-2">
                                OAuth
                                <AntTag className="m-0 text-[10px]">Soon</AntTag>
                            </span>
                        ),
                        value: "oauth",
                        disabled: true,
                    },
                ]}
            />
        </RailField>

        <RailField
            label={railInfoLabel(
                "Header name",
                "The HTTP header required by the MCP server, for example x-api-key",
            )}
            align="center"
        >
            <AntInput value="x-api-key" placeholder="x-api-key" readOnly />
        </RailField>

        <RailField
            label={railInfoLabel(
                "Project secret",
                "The selected secret is resolved securely when the agent runs",
            )}
            align="center"
        >
            <AntSelect
                className="w-full"
                value="exa-api-key"
                open={false}
                options={SECRETS.map((secret) => ({label: secret.name, value: secret.slug}))}
            />
        </RailField>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {value: SECRET_SERVER, onChange: noop},
    parameters: seed,
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="secret header"
                a={<AntdForm />}
                s={<McpServerFormView value={SECRET_SERVER} onChange={noop} />}
            />
            <Row
                label="invalid name"
                a={<AntdForm invalid />}
                s={<McpServerFormView value={INVALID_SECRET_SERVER} onChange={noop} />}
            />
        </div>
    ),
}
