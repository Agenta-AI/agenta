import {useState} from "react"

import {PromptImageUpload, type PromptUploadFile} from "@agenta/ui/components/presentational"
import {MinusCircleOutlined} from "@ant-design/icons"
import {Image as ImageIcon} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button, Input, Typography, Upload} from "antd"

// PromptImageUpload is a drag-and-drop image uploader (file + URL input). It was migrated off antd
// (`Upload.Dragger` + `Typography.Text` + `Input` + `Button`) to a native drop-zone (the
// `usePromptFileUpload` hook) + @agenta/ui primitives. The antd column reproduces the
// pre-migration BODY — a bare `Dragger` is not the right baseline, because the component always
// re-skinned the Dragger into a bordered single row (`.ant-upload-drag` border/background removed).
const {Dragger} = Upload

const meta = {
    title: "@agenta/ui/Presentational/Attachments/PromptImageUpload",
    component: PromptImageUpload,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A drag-and-drop image uploader (file + URL input). Migrated off antd `Upload.Dragger`/`Input`/`Button` to a native drop-zone (`usePromptFileUpload` hook) + @agenta/ui primitives (Spinner/Progress/InputAffix). Shown beside a reproduction of the pre-migration antd body.\n\n**Used in:** 1 place — the playground turn-message adapter (`@agenta/playground-ui` `adapters/TurnMessageAdapter.tsx`).",
            },
        },
    },
} satisfies Meta<typeof PromptImageUpload>

export default meta
type Story = StoryObj

/**
 * Reproduction of the pre-migration antd body (commit e29e3f8586^): the re-skinned `Dragger`
 * shell, `Typography.Text` + link `Button`, antd `Input allowClear`, and the text `Button` with
 * `MinusCircleOutlined`. The `--ag-c-*` compat shims the original hard-coded are spelled as the
 * semantic tokens the migrated component uses — they are the SAME value in light
 * (`--ag-c-BDC7D1` = `colorBorder` = #bdc7d1, `--ag-c-758391` = `colorTextTertiary` = #758391)
 * and adapt in dark, so the pair stays about antd widgets vs @agenta/ui widgets.
 */
const AntdPromptImageUpload = ({disabled}: {disabled?: boolean}) => (
    <Dragger
        accept="image/*"
        showUploadList={false}
        openFileDialogOnClick={false}
        beforeUpload={() => false}
        disabled={disabled}
        className={[
            "w-full flex items-center gap-4 py-2 pr-1 pl-2 rounded-md",
            "[&_.ant-upload-drag]:bg-transparent [&_.ant-upload-drag]:border-none",
            "[&_.ant-upload-btn]:!p-0",
            "border border-solid border-colorBorder",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
    >
        <div className="flex items-center gap-1">
            <div className="flex items-center gap-4 w-full">
                <ImageIcon size={48} className="text-colorTextTertiary" />
                <div className="flex flex-col w-full items-start">
                    <Typography.Text>
                        Drag an image here or{" "}
                        <Button type="link" className="p-0 underline">
                            upload a file
                        </Button>
                    </Typography.Text>
                    <Input
                        placeholder="(Optionally) Enter a valid URL"
                        value=""
                        type="url"
                        allowClear
                    />
                </div>
            </div>
            <Button disabled={disabled} icon={<MinusCircleOutlined />} type="text" />
        </div>
    </Dragger>
)

const AgentaControlled = ({disabled}: {disabled?: boolean}) => {
    const [file, setFile] = useState<PromptUploadFile | null>(null)
    return (
        <PromptImageUpload
            disabled={disabled}
            imageFile={file ?? undefined}
            handleUploadFileChange={setFile}
            handleRemoveUploadFile={() => setFile(null)}
        />
    )
}

// The uploader's own root is a plain `<div>` (antd's is `.ant-upload-wrapper`) — neither is in the
// harness SUBJECT list, and both cells contain a `<button>` ("upload a file") that would otherwise
// be picked as the subject. `data-vrt-subject` on the fixed-width wrapper pairs the whole widgets.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="w-[320px]">
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="w-[320px]">
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="empty" a={<AntdPromptImageUpload />} s={<AgentaControlled />} />
            <Row
                label="disabled"
                a={<AntdPromptImageUpload disabled />}
                s={<AgentaControlled disabled />}
            />
        </div>
    ),
}
