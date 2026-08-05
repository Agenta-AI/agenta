import type {ReactNode} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {
    AgentTemplateSectionList,
    SchemaPropertyRenderer,
    SectionAddButton,
    SectionTitleBadge,
    type AgentTemplateSectionDescriptor,
} from "@agenta/entity-ui/drill-in"
import {
    Cpu,
    FileText,
    GraduationCap,
    Plugs,
    Plus,
    SlidersHorizontal,
    Wrench,
} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Tooltip as AntTooltip, Typography as AntTypography} from "antd"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

// AgentTemplateControl — the agent playground's left config panel and the composition root of
// `SchemaControls/agentTemplate/*`. Its own antd surface was small (three `Tooltip` + icon
// `Button` header actions and one `Typography.Text`), so the migration split the markup out of
// the 1199-line container into three prop-driven siblings:
//
//   • SectionAddButton         — antd `Tooltip title` + `Button type="text" icon` →
//                                Radix Tooltip + `Button variant="ghost" size="icon"`.
//                                forwardRef + prop spread so it can BE a Popover trigger.
//   • SectionTitleBadge        — the "No model" / "Unavailable" / "Connect key" pill (pure move,
//                                no antd involved; extracted so the state matrix is storiable).
//   • AgentTemplateSectionList — the accordion list + the empty note
//                                (antd `Typography.Text type="secondary"` → `<span>` on
//                                `colorTextDescription`, antd's Typography line-height).
//
// The container keeps every atom read (open-section request, draft-change signal, jotai store)
// and builds the section descriptors; the list renders them.
const meta = {
    title: "@agenta/entity-ui/DrillIn/AgentTemplateControl",
    component: SchemaPropertyRenderer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Agent config panel. Data-connected container (harness catalog, vault secrets, " +
                    "section-change diff) rendered through its real dispatch path — " +
                    "`SchemaPropertyRenderer` on an `x-ag-type: agent-template` schema, which " +
                    "lazy-loads the code-split control. Presentational siblings are storied directly.",
            },
        },
    },
} satisfies Meta<typeof SchemaPropertyRenderer>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

// ---------------------------------------------------------------------------
// Fixtures — the agent-template schema + a populated value
// ---------------------------------------------------------------------------

/**
 * The `agent-template` catalog type, trimmed to the fields the panel gates its sections on.
 * `x-ag-harness-ref` is what opts the harness field into the catalog-driven capability map
 * (seeded below), which is in turn what makes the MCP section available.
 */
const AGENT_SCHEMA = {
    type: "object",
    "x-ag-type": "agent-template",
    title: "Agent",
    properties: {
        instructions: {
            // schema-gen emits the wrapper class name here; the panel rejects leading-underscore
            // titles and falls back to the literal "Instructions".
            title: "_InstructionsSchema",
            type: "object",
            properties: {agents_md: {type: "string"}},
        },
        llm: {title: "Model", type: "object"},
        harness: {
            title: "Harness",
            type: "object",
            properties: {
                kind: {
                    type: "string",
                    title: "Harness",
                    enum: ["claude_code", "codex"],
                    "x-ag-harness-ref": "harnesses",
                },
            },
        },
        tools: {title: "Tools", type: "array", items: {type: "object"}},
        mcps: {title: "MCPs", type: "array", items: {type: "object"}},
        skills: {title: "Skills", type: "array", items: {type: "object"}},
        sandbox: {
            title: "Sandbox",
            type: "object",
            properties: {kind: {type: "string", enum: ["local", "e2b"]}},
        },
    },
}

/** A schema with none of the agent fields — the panel's empty branch. */
const EMPTY_SCHEMA = {type: "object", "x-ag-type": "agent-template", properties: {}}

const AGENT_VALUE = {
    instructions: {agents_md: "# AGENTS.md\n\nBe terse. Answer in one line."},
    llm: {
        model: "claude-sonnet-4-5",
        provider: "anthropic",
        connection: {mode: "agenta"},
    },
    harness: {kind: "claude_code"},
    tools: [
        {name: "web_search", description: "Search the web"},
        {name: "read_file", description: "Read a file from the workspace"},
    ],
    mcps: [{name: "linear", url: "https://mcp.linear.app/sse"}],
    skills: [{name: "release-notes", description: "Draft release notes from a changelog"}],
    sandbox: {kind: "local"},
}

/** An agent with the schema present but nothing configured — every list section is empty. */
const BLANK_VALUE = {instructions: {agents_md: ""}, harness: {kind: "claude_code"}}

/**
 * The harness catalog (`["workflows","catalog","harnesses"]` — global and project-independent,
 * see `entities/workflow/state/inspectMeta.ts`). Without it `mcpSupported` is false and the
 * model picker falls back to its unfiltered form.
 */
const HARNESS_CATALOG = {
    claude_code: {
        providers: ["anthropic"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "alias",
        models: {anthropic: ["claude-sonnet-4-5", "claude-opus-4-1"]},
        mcp: {user_servers: {connection_types: ["http"], credentials: ["bearer"]}},
    },
    codex: {
        providers: ["openai"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {openai: ["gpt-5", "gpt-5-mini"]},
        mcp: {user_servers: null},
    },
}

const agentQueries = (_scope: StoryScope): [readonly unknown[], unknown][] => [
    [["workflows", "catalog", "harnesses"], HARNESS_CATALOG],
]

// ---------------------------------------------------------------------------
// Container stories (data seam)
// ---------------------------------------------------------------------------

const renderPanel = (schema: unknown, value: unknown, disabled?: boolean) => (
    // The panel lives inside PlaygroundConfigSection's `px-4` field wrapper; the expanded
    // header band bleeds to those edges, so the story reproduces the padding.
    // Showcase (no antd half), so there is no `.grid` parity layout — `data-vrt-subject` is
    // what the a11y/VRT harness waits on to know the story has rendered.
    <div data-vrt-subject className="max-w-[520px] px-4">
        <SchemaPropertyRenderer
            schema={schema as SchemaProperty}
            label="Agent"
            value={value}
            onChange={noop}
            disabled={disabled}
        />
    </div>
)

/** Everything configured: model + harness, instructions, two tools, an MCP server, a skill. */
export const Configured: Story = {
    args: {
        schema: AGENT_SCHEMA as SchemaProperty,
        label: "Agent",
        value: AGENT_VALUE,
        onChange: noop,
    },
    parameters: {agenta: {queries: agentQueries}},
    render: () => renderPanel(AGENT_SCHEMA, AGENT_VALUE),
}

/** Schema present, nothing configured — every list section renders its empty-state add link. */
export const Blank: Story = {
    args: {
        schema: AGENT_SCHEMA as SchemaProperty,
        label: "Agent",
        value: BLANK_VALUE,
        onChange: noop,
    },
    parameters: {agenta: {queries: agentQueries}},
    render: () => renderPanel(AGENT_SCHEMA, BLANK_VALUE),
}

/**
 * No harness catalog fixture: the capability map never resolves, so the panel renders its
 * catalog-less fallback (no MCP section, unfiltered model picker) — the state a slow or failed
 * `/catalog/harnesses` produces in the app.
 */
export const CatalogUnavailable: Story = {
    args: {
        schema: AGENT_SCHEMA as SchemaProperty,
        label: "Agent",
        value: AGENT_VALUE,
        onChange: noop,
    },
    parameters: {agenta: {queries: []}},
    render: () => renderPanel(AGENT_SCHEMA, AGENT_VALUE),
}

/** Read-only (a run is in flight): every header `+` and every row action is gone. */
export const Disabled: Story = {
    args: {
        schema: AGENT_SCHEMA as SchemaProperty,
        label: "Agent",
        value: AGENT_VALUE,
        onChange: noop,
        disabled: true,
    },
    parameters: {agenta: {queries: agentQueries}},
    render: () => renderPanel(AGENT_SCHEMA, AGENT_VALUE, true),
}

/** A resolved schema that declares no agent fields — the panel's empty note. */
export const EmptySchema: Story = {
    args: {schema: EMPTY_SCHEMA as SchemaProperty, label: "Agent", value: {}, onChange: noop},
    parameters: {agenta: {queries: agentQueries}},
    render: () => renderPanel(EMPTY_SCHEMA, {}),
}

// ---------------------------------------------------------------------------
// Presentational: AgentTemplateSectionList
// ---------------------------------------------------------------------------

const Body = ({children}: {children: ReactNode}) => (
    <div className="text-xs text-colorTextSecondary">{children}</div>
)

const SECTIONS: AgentTemplateSectionDescriptor[] = [
    {
        key: "model-harness",
        icon: <Cpu size={16} />,
        title: "Model & harness",
        titleBadge: <SectionTitleBadge label="Connect key" tone="warning" />,
        summary: "Claude Code · Sonnet 4.5",
        indicator: {
            tone: "incomplete",
            tooltip: "Connect the model's provider key to run this agent.",
        },
        onOpen: noop,
        content: <Body>Model & harness drawer body</Body>,
    },
    {
        key: "instructions",
        icon: <FileText size={16} />,
        title: "Instructions",
        summary: "1 file",
        indicator: {tone: "draft", tooltip: "Unsaved instruction changes."},
        extra: (
            <SectionAddButton
                label="Add instruction file"
                tooltip="Multiple instruction files coming soon"
                disabled
            />
        ),
        defaultOpen: true,
        content: <Body>AGENTS.md</Body>,
    },
    {
        key: "tools",
        icon: <Wrench size={16} />,
        title: "Tools",
        summary: "2 tools",
        extra: <SectionAddButton label="Add tool" onClick={noop} />,
        defaultOpen: true,
        content: <Body>web_search · read_file</Body>,
    },
    {
        key: "mcp",
        icon: <Plugs size={16} />,
        title: "MCPs",
        summary: "1 server",
        indicator: {tone: "invalid", tooltip: "An MCP server is missing its name or URL."},
        extra: <SectionAddButton label="Add MCP server" onClick={noop} />,
        content: <Body>linear</Body>,
    },
    {
        key: "skills",
        icon: <GraduationCap size={16} />,
        title: "Skills",
        summary: "1 skill",
        indicator: {tone: "agent", tooltip: "Updated by the agent in v4"},
        extra: <SectionAddButton label="Add skill" onClick={noop} />,
        content: <Body>release-notes</Body>,
    },
    {
        key: "advanced",
        icon: <SlidersHorizontal size={16} />,
        title: "Advanced",
        summary: "Sandbox: local",
        onOpen: noop,
        content: <Body>Advanced drawer body</Body>,
    },
]

/** Every indicator tone, both header-action shapes, drawer rows and inline rows. */
export const SectionList: Story = {
    args: {
        schema: AGENT_SCHEMA as SchemaProperty,
        label: "Agent",
        value: AGENT_VALUE,
        onChange: noop,
    },
    render: () => (
        <div data-vrt-subject className="flex max-w-[520px] flex-col px-4">
            <AgentTemplateSectionList
                sections={SECTIONS}
                controlledKeys={new Set(["tools", "mcp", "skills"])}
                openByKey={{tools: true, mcp: false, skills: false}}
                onOpenChange={noop}
            />
        </div>
    ),
}

/** The empty branch — no agent fields in the resolved schema. */
export const SectionListEmpty: Story = {
    args: {schema: EMPTY_SCHEMA as SchemaProperty, label: "Agent", value: {}, onChange: noop},
    render: () => (
        <div data-vrt-subject className="flex max-w-[520px] flex-col">
            <AgentTemplateSectionList sections={[]} />
        </div>
    ),
}

// ---------------------------------------------------------------------------
// Pre-migration markup, verbatim (antd baseline)
// ---------------------------------------------------------------------------

/** `headerAddButton` before the migration. */
const AntdHeaderAddButton = ({label}: {label: string}) => (
    <AntTooltip title={label}>
        <AntButton type="text" icon={<Plus size={16} />} onClick={noop} aria-label={label} />
    </AntTooltip>
)

/** The Instructions section's inert `+` — a disabled button swallows hover, hence the span. */
const AntdDisabledAddButton = () => (
    <AntTooltip title="Multiple instruction files coming soon">
        <span>
            <AntButton
                type="text"
                icon={<Plus size={16} />}
                disabled
                aria-label="Add instruction file"
            />
        </span>
    </AntTooltip>
)

/** The title pill, before it moved into SectionTitleBadge (markup unchanged). */
const AntdTitlePill = ({label, tone}: {label: string; tone: "warning" | "error"}) => (
    <span
        className={[
            "whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium leading-none",
            tone === "error"
                ? "bg-[var(--ag-colorErrorBg)] text-[var(--ag-colorError)]"
                : "bg-[var(--ag-colorWarningBg)] text-[var(--ag-colorWarning)]",
        ].join(" ")}
    >
        {label}
    </span>
)

/** The "no agent fields" note. */
const AntdEmptyNote = () => (
    <AntTypography.Text type="secondary" className="text-xs">
        No agent configuration fields are available for this schema.
    </AntTypography.Text>
)

// ---------------------------------------------------------------------------
// Parity grid
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
        className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex flex-1 items-center">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex flex-1 items-center">
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {
        schema: AGENT_SCHEMA as SchemaProperty,
        label: "Agent",
        value: AGENT_VALUE,
        onChange: noop,
    },
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="header + (enabled)"
                a={<AntdHeaderAddButton label="Add MCP server" />}
                s={<SectionAddButton label="Add MCP server" onClick={noop} />}
            />
            <Row
                label="header + (disabled)"
                a={<AntdDisabledAddButton />}
                s={
                    <SectionAddButton
                        label="Add instruction file"
                        tooltip="Multiple instruction files coming soon"
                        disabled
                    />
                }
            />
            <Row
                label="title pill — error"
                a={<AntdTitlePill label="No model" tone="error" />}
                s={<SectionTitleBadge label="No model" tone="error" />}
            />
            <Row
                label="title pill — warning"
                a={<AntdTitlePill label="Connect key" tone="warning" />}
                s={<SectionTitleBadge label="Connect key" tone="warning" />}
            />
            <Row
                label="empty note"
                a={<AntdEmptyNote />}
                s={<AgentTemplateSectionList sections={[]} />}
            />
        </div>
    ),
}
