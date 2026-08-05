import type {ToolResult} from "@agenta/entities/gatewayTool"
import {ResultViewer} from "@agenta/entity-ui/gatewayTool"
import {CopySimple} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Alert as AntAlert, Button as AntButton, Form as AntForm, Input as AntInput} from "antd"

// ResultViewer — read-only tool-execution output. antd halves replay the pre-migration
// body (antd `Alert` / `Form layout="vertical"` + read-only `Input`s); the agenta cells
// render the migrated component (ui `Alert`, `Field` + read-only `Input`/`Textarea`).
// Whole-block cells are pinned with `data-vrt-subject` (each side contains several
// SUBJECT candidates — inputs, buttons — so the wrapper is the unambiguous subject).
const meta = {
    title: "@agenta/entity-ui/GatewayTool/ResultViewer",
    component: ResultViewer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Read-only viewer for a tool execution result: error alert, schema/data-derived fields, or a JSON editor. antd `Alert`/`Form`/`Input`/`InputNumber` → ui `Alert`/`Field`/`Input`/`InputNumber`/`Textarea`; the layout-only antd `Form` was dropped.",
            },
        },
    },
} satisfies Meta<typeof ResultViewer>

export default meta
type Story = StoryObj

const fieldsResult = {
    status: {code: "STATUS_CODE_OK"},
    data: {
        content: JSON.stringify({
            subject: "Weekly report",
            recipient: "team@example.com",
        }),
    },
} as unknown as ToolResult

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    /** Declares a deliberate divergence: still measured and reported, but not gated. */
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject>{a}</div>
        </div>
        <div className="flex flex-col gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject>{s}</div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="execution error"
                a={
                    <AntAlert
                        type="error"
                        message="Execution Failed"
                        description="Connection refused"
                        showIcon
                    />
                }
                s={<ResultViewer result={null} error="Connection refused" />}
            />
            <Row
                label="tool status error"
                a={
                    <AntAlert
                        type="error"
                        message="Tool returned an error"
                        description="STATUS_CODE_FAILED: rate limited"
                        showIcon
                    />
                }
                s={
                    <ResultViewer
                        result={
                            {
                                status: {code: "STATUS_CODE_FAILED", message: "rate limited"},
                            } as unknown as ToolResult
                        }
                    />
                }
            />
            <Row
                label="read-only fields"
                expected="Field consolidation: labels render via ui Field (12px/500, 4px gap) instead of antd Form.Item labels (14px/400, 8px pad) — the app-wide Field look; controls themselves match"
                a={
                    <div className="flex flex-col gap-1">
                        <AntButton
                            type="text"
                            aria-label="Copy result"
                            icon={<CopySimple size={14} />}
                            size="small"
                            className="self-end opacity-70"
                        />
                        <AntForm
                            layout="vertical"
                            disabled
                            className="[&_.ant-form-item]:!mb-2 [&_.ant-input-disabled]:!text-[var(--ant-color-text)]"
                        >
                            {/* Labels are raw data keys (buildFormFieldsFromData) — lowercase. */}
                            <AntForm.Item label="subject">
                                <AntInput value="Weekly report" readOnly />
                            </AntForm.Item>
                            <AntForm.Item label="recipient">
                                <AntInput value="team@example.com" readOnly />
                            </AntForm.Item>
                        </AntForm>
                    </div>
                }
                s={<ResultViewer result={fieldsResult} />}
            />
        </div>
    ),
}

/** Fields derived from the data keys (no output schema) — the common case. */
export const Fields: Story = {
    render: () => (
        <div className="max-w-[520px]">
            <ResultViewer result={fieldsResult} />
        </div>
    ),
}
