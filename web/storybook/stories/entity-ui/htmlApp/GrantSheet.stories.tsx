import {useState} from "react"

import {type GrantLevel} from "@agenta/entities/drive"
import {GrantSheet} from "@agenta/entity-ui/drive"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {APP_DIR} from "../../../fixtures/htmlApp"

/**
 * The access question an app raises on its first file call. Four states: read preselected (the
 * manifest asks for `read`, or asks for nothing), read-write preselected (the manifest asks for it
 * and the user may edit mounts), the write option hidden (the drive's upload gate is off), and the
 * cancel path. "Don't allow" is always offered.
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
    container,
}: {
    requested: GrantLevel
    canWrite: boolean
    appName?: string
    container?: HTMLElement | null
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
                Ask…
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
                container={container}
                onCancel={() => {
                    setOutcome("cancelled → no access this run")
                    setOpen(false)
                }}
                onConfirm={(level) => {
                    setOutcome(`answered ${level}`)
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

/** Acceptance: Cancel closes the sheet; the app keeps running with no access (click "Ask…" again). */
export const Cancel: Story = {
    args: {requested: "read", canWrite: true},
    render: (args) => (
        <Harness requested={args.requested} canWrite={args.canWrite} appName="Broken app" />
    ),
}

/** Confined to a pane (the Files pane in the drive): only the pane is masked, the rest stays live. */
export const ContainedInPane: Story = {
    args: {requested: "read", canWrite: true},
    render: function Render(args) {
        const [pane, setPane] = useState<HTMLDivElement | null>(null)
        return (
            <div className="flex h-[420px] w-[760px] gap-3 text-xs">
                <textarea
                    className="w-[300px] rounded border border-solid border-colorBorder bg-colorBgContainer p-2 text-colorText"
                    defaultValue="The chat column stays usable while the sheet is open."
                />
                <div
                    ref={setPane}
                    className="relative flex-1 overflow-hidden rounded border border-solid border-colorBorderSecondary"
                >
                    {pane ? (
                        <Harness
                            requested={args.requested}
                            canWrite={args.canWrite}
                            container={pane}
                        />
                    ) : null}
                </div>
            </div>
        )
    },
}
