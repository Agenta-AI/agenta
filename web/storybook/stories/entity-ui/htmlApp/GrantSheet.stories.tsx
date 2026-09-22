import {useState} from "react"

import {type GrantLevel} from "@agenta/entities/drive"
import {GrantSheet} from "@agenta/entity-ui/drive"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {APP_DIR} from "../../../fixtures/htmlApp"

/**
 * The grant question before an app runs. Four states: read preselected (the manifest asks for
 * `read`, or asks for nothing), read-write preselected (the manifest asks for it and the user may
 * edit mounts), the write option hidden (the drive's upload gate is off), and the cancel path.
 */
const meta = {
    title: "@agenta/entity-ui/Drive/HtmlApp/GrantSheet",
    component: GrantSheet,
    parameters: {layout: "padded"},
    tags: ["!autodocs"],
} satisfies Meta<typeof GrantSheet>

export default meta
type Story = StoryObj<typeof meta>

/** Opens the sheet from a button (Radix-managed open, what the a11y runner audits) and logs
 * the outcome, so the confirm/cancel round trip is visible. */
const Harness = ({
    requested,
    canWrite,
    appName = "Retro board",
}: {
    requested: GrantLevel
    canWrite: boolean
    appName?: string
}) => {
    const [open, setOpen] = useState(true)
    const [outcome, setOutcome] = useState<string>("(no answer yet)")
    return (
        <div className="flex h-[200px] w-[480px] flex-col items-start gap-3 text-xs text-colorTextSecondary">
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="cursor-pointer rounded border border-solid border-colorBorder bg-colorBgContainer px-2 py-1 text-xs text-colorText hover:bg-colorFillTertiary"
            >
                Run…
            </button>
            <span>
                Outcome: <code className="text-colorText">{outcome}</code>
            </span>
            <GrantSheet
                open={open}
                appName={appName}
                dir={APP_DIR}
                requested={requested}
                canWrite={canWrite}
                onCancel={() => {
                    setOutcome("cancelled → back to Preview")
                    setOpen(false)
                }}
                onConfirm={(level) => {
                    setOutcome(`granted ${level}`)
                    setOpen(false)
                }}
            />
        </div>
    )
}

/** Acceptance: manifest `access: "read"` (or no manifest) → Read files preselected. */
export const ReadPreselected: Story = {
    args: {requested: "read", canWrite: true},
    render: (args) => <Harness requested={args.requested} canWrite={args.canWrite} />,
}

/** Acceptance: manifest `access: "read-write"` and the user may edit mounts → preselected. */
export const ReadWritePreselected: Story = {
    args: {requested: "read-write", canWrite: true},
    render: (args) => <Harness requested={args.requested} canWrite={args.canWrite} />,
}

/** Acceptance: uploads disabled for this drive → the write option is not offered, and a manifest
 * asking for read-write is narrowed to read. */
export const WriteHidden: Story = {
    args: {requested: "read-write", canWrite: false},
    render: (args) => <Harness requested={args.requested} canWrite={args.canWrite} />,
}

/** Acceptance: Cancel closes the sheet and returns to Preview (click Cancel, then "Run…" again). */
export const Cancel: Story = {
    args: {requested: "read", canWrite: true},
    render: (args) => (
        <Harness requested={args.requested} canWrite={args.canWrite} appName="Broken app" />
    ),
}
