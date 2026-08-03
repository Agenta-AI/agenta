import {useEffect} from "react"

import {
    ResponseFormatControl,
    ResponseFormatControlView,
    responseFormatModalOpenAtom,
} from "@agenta/entity-ui/drill-in"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Select as AntSelect} from "antd"
import {useSetAtom} from "jotai"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

// ResponseFormatControl — output-type picker + JSON-schema editor modal.
//
// SPLIT (rule 2): the container reads `responseFormatModalOpenAtom` (which control's modal
// is open) and renders `ResponseFormatControlView`, which is pure props. The showcase
// stories drive the VIEW; `AtomDrivenModal` is the data-seam story that drives the
// CONTAINER by seeding the atom, exactly the way the app opens it.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ResponseFormatControl",
    component: ResponseFormatControlView,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Output-type picker (text / JSON / JSON schema) with a schema editor in an EnhancedModal. antd `Select` → `@agenta/ui` `Select` composition (`popupMatchSelectWidth={false}` → `w-auto` on the content; `style={{height:24}}` → `h-control-sm`), antd `Button variant="outlined"` → `variant="outline"`, antd `Typography.Text` → `<span>`.',
            },
        },
    },
} satisfies Meta<typeof ResponseFormatControlView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/** Default: plain text output. */
export const TextFormat: Story = {args: {value: {type: "text"}, onChange: noop, size: "sm"}}

/** JSON mode — no schema button. */
export const JsonObjectFormat: Story = {
    args: {value: {type: "json_object"}, onChange: noop, size: "sm"},
}

/** JSON schema — the extra "Edit Schema" button appears, labelled from `json_schema.name`. */
export const JsonSchemaFormat: Story = {
    args: {
        value: {
            type: "json_schema",
            json_schema: {name: "Verdict", schema: {type: "object", properties: {}}},
        },
        onChange: noop,
        size: "sm",
    },
}

/** JSON schema with no `name` → the "Edit Schema" fallback label. */
export const JsonSchemaUnnamed: Story = {
    args: {value: {type: "json_schema", json_schema: {}}, onChange: noop, size: "sm"},
}

/** Disabled — and the modal is not even mounted when disabled. */
export const Disabled: Story = {
    args: {
        value: {type: "json_schema", json_schema: {name: "Verdict"}},
        disabled: true,
        onChange: noop,
        size: "sm",
    },
}

/** The schema editor modal, driven by props (`open`). */
export const SchemaModalOpen: Story = {
    args: {
        value: {
            type: "json_schema",
            json_schema: {name: "Verdict", schema: {type: "object", properties: {}}},
        },
        onChange: noop,
        size: "sm",
        open: true,
        onOpenChange: noop,
    },
    // The modal portals to <body>; stacking every story on the docs page would pile dialogs.
    tags: ["!autodocs"],
}

/**
 * **Data-seam story.** Drives the CONTAINER: `responseFormatModalOpenAtom` is seeded with
 * this story's scoped controlId, which is exactly what `handleFormatChange` /
 * `handleOpenModal` write in the app. Only that one atom is seeded — the control reads
 * nothing else.
 */
export const AtomDrivenModal: Story = {
    tags: ["!autodocs"],
    args: {value: {type: "json_schema"}, onChange: noop},
    parameters: {
        agenta: {
            queries: [],
            args: (scope: StoryScope) => ({controlId: scope.id("rf")}),
            // L2: the atom is a non-family singleton, so rewind it before this story renders.
            reset: [[responseFormatModalOpenAtom, null]],
        },
    },
    render: (args) => {
        const controlId = (args as {controlId?: string}).controlId ?? "rf"
        return (
            <SeedOpenModal controlId={controlId}>
                <ResponseFormatControl
                    controlId={controlId}
                    value={{
                        type: "json_schema",
                        json_schema: {name: "Verdict", schema: {type: "object", properties: {}}},
                    }}
                    onChange={noop}
                    size="sm"
                />
            </SeedOpenModal>
        )
    },
}

/** Seeds the open-modal atom with the story-scoped controlId before the container reads it. */
function SeedOpenModal({controlId, children}: {controlId: string; children: React.ReactNode}) {
    const setOpen = useSetAtom(responseFormatModalOpenAtom)
    useEffect(() => {
        setOpen(controlId)
    }, [controlId, setOpen])
    return <>{children}</>
}

// ---------------------------------------------------------------------------
// Parity: the two migrated controls
// ---------------------------------------------------------------------------

const RESPONSE_FORMAT_OPTIONS = [
    {label: "Output type: Text", value: "text"},
    {label: "Output type: JSON", value: "json_object"},
    {label: "Output type: JSON Schema", value: "json_schema"},
]

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
        className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3"
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

export const AntdVsAgenta: Story = {
    args: {value: {type: "text"}, onChange: noop},
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row
                label="output type select"
                a={
                    <AntSelect
                        size="small"
                        value="text"
                        options={RESPONSE_FORMAT_OPTIONS}
                        className="min-w-[130px]"
                        popupMatchSelectWidth={false}
                        style={{height: 24}}
                    />
                }
                s={<ResponseFormatControlView value={{type: "text"}} onChange={noop} size="sm" />}
            />
            <Row
                label="edit-schema button"
                a={
                    <AntButton variant="outlined" color="default" size="small">
                        Verdict
                    </AntButton>
                }
                s={
                    <Button variant="outline" size="sm">
                        Verdict
                    </Button>
                }
            />
        </div>
    ),
}
