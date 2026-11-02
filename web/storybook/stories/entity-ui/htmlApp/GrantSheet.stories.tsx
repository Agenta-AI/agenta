import {useState} from "react"

import {type AppAccess} from "@agenta/entities/drive"
import {AccessQuestion, GrantSheet} from "@agenta/entity-ui/drive"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {APP_DIR} from "../../../fixtures/htmlApp"

/**
 * The file-access dialogs. The question an app raises for what it tried (reading, or changing
 * files) with Allow / Don't allow, and the ⋯ "File access…" setting with the full choice.
 */
const meta = {
    title: "@agenta/entity-ui/Drive/HtmlApp/GrantSheet",
    component: GrantSheet,
    parameters: {layout: "padded"},
    tags: ["!autodocs"],
} satisfies Meta<typeof GrantSheet>

export default meta
type Story = StoryObj<typeof meta>

const Reopen = ({onClick, outcome}: {onClick: () => void; outcome: string}) => (
    <>
        <button
            type="button"
            onClick={onClick}
            className="cursor-pointer rounded border border-solid border-colorBorder bg-colorBgContainer px-2 py-1 text-xs text-colorText hover:bg-colorFillTertiary"
        >
            Open…
        </button>
        <span>
            Outcome: <code className="text-colorText">{outcome}</code>
        </span>
    </>
)

const QuestionHarness = ({need}: {need: "read" | "write"}) => {
    const [open, setOpen] = useState(true)
    const [outcome, setOutcome] = useState("(no answer yet)")
    return (
        <div className="flex h-[200px] w-[480px] flex-col items-start gap-3 text-xs text-colorTextSecondary">
            <Reopen onClick={() => setOpen(true)} outcome={outcome} />
            <AccessQuestion
                open={open}
                appName="Retro board"
                dir={APP_DIR}
                need={need}
                onAnswer={(allow) => {
                    setOutcome(allow ? "allowed" : "refused (stored)")
                    setOpen(false)
                }}
                onCancel={() => {
                    setOutcome("cancelled → no access this run, nothing stored")
                    setOpen(false)
                }}
            />
        </div>
    )
}

const SettingHarness = ({
    current,
    canWrite,
    container,
}: {
    current: AppAccess | null
    canWrite: boolean
    container?: HTMLElement | null
}) => {
    const [open, setOpen] = useState(true)
    const [outcome, setOutcome] = useState("(not saved)")
    return (
        <div className="flex h-[200px] w-[480px] flex-col items-start gap-3 text-xs text-colorTextSecondary">
            <Reopen onClick={() => setOpen(true)} outcome={outcome} />
            {open ? (
                <GrantSheet
                    open
                    appName="Retro board"
                    dir={APP_DIR}
                    current={current}
                    canWrite={canWrite}
                    container={container}
                    onCancel={() => setOpen(false)}
                    onSave={(level) => {
                        setOutcome(`saved ${level}`)
                        setOpen(false)
                    }}
                />
            ) : null}
        </div>
    )
}

/** The app's first read: "Let Retro board read files in …?" */
export const ReadQuestion: Story = {
    render: () => <QuestionHarness need="read" />,
}

/** The app's first write: "Let Retro board change files in …?"; Allow gives read and write. */
export const WriteQuestion: Story = {
    render: () => <QuestionHarness need="write" />,
}

/** The ⋯ setting with read stored: Read, Read and write, None; read preselected. */
export const SettingRead: Story = {
    render: () => <SettingHarness current="read" canWrite />,
}

/** Never answered: nothing preselected, Save waits for a choice. */
export const SettingNotSet: Story = {
    render: () => <SettingHarness current={null} canWrite />,
}

/** Uploads disabled for this drive: only Read and None are offered. */
export const SettingWriteHidden: Story = {
    render: () => <SettingHarness current="read-write" canWrite={false} />,
}

/** Confined to a pane (the Files pane in the drive): only the pane is masked, the rest stays live. */
export const ContainedInPane: Story = {
    render: function Render() {
        const [pane, setPane] = useState<HTMLDivElement | null>(null)
        return (
            <div className="flex h-[420px] w-[760px] gap-3 text-xs">
                <textarea
                    className="w-[300px] rounded border border-solid border-colorBorder bg-colorBgContainer p-2 text-colorText"
                    defaultValue="The chat column stays usable while the dialog is open."
                />
                <div
                    ref={setPane}
                    className="relative flex-1 overflow-hidden rounded border border-solid border-colorBorderSecondary"
                >
                    {pane ? <SettingHarness current="read" canWrite container={pane} /> : null}
                </div>
            </div>
        )
    },
}
