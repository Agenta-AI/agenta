import {useState} from "react"

import {Badge, Button, Segmented} from "@agenta/ui/ui"
import {Wrench} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Segmented as AntSegmented, Tag as AntTag} from "antd"

// Imported from source: the DrillInView barrel does not re-export this drawer.
import {
    ConfigItemDrawer,
    type ConfigItemView,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/ConfigItemDrawer"

// ConfigItemDrawer — the shared item-config drawer chrome (header identity + Form/JSON toggle,
// body, Cancel/Save footer) for tools, MCP servers and skills.
//
// Migration: antd `Tag` (type badge) → `Badge`, antd `Segmented` → `@agenta/ui` `Segmented`,
// antd `Button`/`Button type="primary"` → `Button variant="outline"`/`variant="default"`.
// The drawer portals to `body`, so the open-state stories are SHOWCASES (they cannot sit in a
// `[label | antd | agenta]` grid cell); `AntdVsAgenta` pairs the header/footer chrome inline.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ConfigItemDrawer",
    component: ConfigItemDrawer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Right-hand drawer chrome for one config item: icon + title + type badge + subtitle, a Form/JSON toggle in `extra`, and a Cancel/Save footer that commits the host's draft.",
            },
        },
    },
} satisfies Meta<typeof ConfigItemDrawer>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const FormBody = () => (
    <div className="flex flex-col gap-3 text-xs text-colorTextSecondary">
        <p className="m-0">
            The `form` slot — ToolFormView / McpServerFormView / SkillFormView in the app. This
            story exercises the drawer shell.
        </p>
    </div>
)

const JsonBody = () => (
    <pre className="m-0 rounded border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-3 font-mono text-xs">
        {`{\n  "name": "search_docs",\n  "type": "function"\n}`}
    </pre>
)

const DrawerDemo = ({
    mode = "edit",
    jsonOnly = false,
    disabled = false,
    saveDisabled = false,
    contentFlush = false,
}: {
    mode?: "create" | "edit"
    jsonOnly?: boolean
    disabled?: boolean
    saveDisabled?: boolean
    contentFlush?: boolean
}) => {
    const [open, setOpen] = useState(true)
    const [view, setView] = useState<ConfigItemView>("form")
    return (
        <div className="p-4">
            <Button variant="outline" onClick={() => setOpen(true)}>
                Open config item drawer
            </Button>
            <ConfigItemDrawer
                open={open}
                mode={mode}
                icon={<Wrench size={16} />}
                title="search_docs"
                badge={{text: "definition", color: "cyan"}}
                subtitle="A schema-only function the agent can call."
                footerNote="Changes apply to this agent configuration"
                view={view}
                onViewChange={setView}
                onCancel={() => setOpen(false)}
                onSave={() => setOpen(false)}
                saveDisabled={saveDisabled}
                jsonOnly={jsonOnly}
                disabled={disabled}
                contentFlush={contentFlush}
                form={<FormBody />}
                json={<JsonBody />}
            />
        </div>
    )
}

/** Edit an existing item — Form view, Save enabled. */
export const Default: Story = {
    args: {
        open: true,
        mode: "edit",
        title: "search_docs",
        view: "form",
        onViewChange: noop,
        onCancel: noop,
        onSave: noop,
        form: null,
        json: null,
    },
    render: () => <DrawerDemo />,
}

/** Create flow — the primary action reads "Create". */
export const CreateMode: Story = {
    args: Default.args,
    render: () => <DrawerDemo mode="create" />,
}

/** Draft missing a required field — Save disabled, toggle still live. */
export const SaveDisabled: Story = {
    args: Default.args,
    render: () => <DrawerDemo saveDisabled />,
}

/** `jsonOnly` — no Form/JSON toggle, JSON body only. */
export const JsonOnly: Story = {
    args: Default.args,
    render: () => <DrawerDemo jsonOnly />,
}

/** Read-only item — toggle and Save both disabled. */
export const ViewOnly: Story = {
    args: Default.args,
    render: () => <DrawerDemo disabled />,
}

/** `contentFlush` — the form lays out its own edge-to-edge master/detail (no body padding). */
export const ContentFlush: Story = {
    args: Default.args,
    render: () => <DrawerDemo contentFlush />,
}

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
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

/** Pre-migration header block (feat/storybook-data-seam). */
const AntdHeader = () => (
    <div className="flex min-w-0 items-center gap-2">
        <span className="flex shrink-0 items-center">
            <Wrench size={16} />
        </span>
        <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">search_docs</span>
                <AntTag color="cyan" className="m-0 shrink-0 text-[11px] font-normal">
                    definition
                </AntTag>
            </div>
            <div className="truncate text-xs font-normal text-[var(--ag-c-97A4B0,#97a4b0)]">
                A schema-only function the agent can call.
            </div>
        </div>
    </div>
)

/** The migrated header block, copied from ConfigItemDrawer's `title` slot. */
const AgentaHeader = () => (
    <div className="flex min-w-0 items-center gap-2">
        <span className="flex shrink-0 items-center">
            <Wrench size={16} />
        </span>
        <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">search_docs</span>
                <Badge variant="cyan" className="shrink-0 text-[11px] font-normal leading-[22.4px]">
                    definition
                </Badge>
            </div>
            <div className="truncate text-xs font-normal text-[var(--ag-c-97A4B0,#97a4b0)]">
                A schema-only function the agent can call.
            </div>
        </div>
    </div>
)

const VIEW_OPTIONS = [
    {label: "Form", value: "form"},
    {label: "JSON", value: "json"},
]

const AntdFooter = ({createMode = false}: {createMode?: boolean}) => (
    <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
            Changes apply to this agent configuration
        </span>
        <div className="flex shrink-0 items-center gap-2">
            <AntButton>Cancel</AntButton>
            <AntButton type="primary">{createMode ? "Create" : "Save"}</AntButton>
        </div>
    </div>
)

const AgentaFooter = ({createMode = false}: {createMode?: boolean}) => (
    <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
            Changes apply to this agent configuration
        </span>
        <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline">Cancel</Button>
            <Button variant="default">{createMode ? "Create" : "Save"}</Button>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: Default.args,
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row label="header" a={<AntdHeader />} s={<AgentaHeader />} />
            <Row
                label="view toggle"
                a={<AntSegmented value="form" options={VIEW_OPTIONS} />}
                s={<Segmented value="form" options={VIEW_OPTIONS} aria-label="Item view" />}
            />
            <Row
                label="view toggle (disabled)"
                a={<AntSegmented value="json" options={VIEW_OPTIONS} disabled />}
                s={
                    <Segmented
                        value="json"
                        options={VIEW_OPTIONS}
                        disabled
                        aria-label="Item view"
                    />
                }
            />
            <Row label="footer (edit)" a={<AntdFooter />} s={<AgentaFooter />} />
            <Row
                label="footer (create)"
                a={<AntdFooter createMode />}
                s={<AgentaFooter createMode />}
            />
        </div>
    ),
}
