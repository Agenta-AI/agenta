import {useState} from "react"

import {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
    buttonVariants,
    Button as ShadButton,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Modal as AntModal, Button as AntButton} from "antd"
import {Trash2} from "lucide-react"

const meta = {
    title: "@agenta/ui/Primitives/Overlays/AlertDialog",
    component: AlertDialogContent,
    subcomponents: {
        AlertDialog,
        AlertDialogTrigger,
        AlertDialogHeader,
        AlertDialogFooter,
        AlertDialogTitle,
        AlertDialogDescription,
        AlertDialogAction,
        AlertDialogCancel,
    },
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` AlertDialog (Radix-based) that replaces antd confirm `Modal`. It is a compound component — compose `AlertDialog` > `AlertDialogContent` > header/footer/action/cancel. Prop tables for each part are below.\n\n**Used in:** 1 place — the global app-message host (`@agenta/ui/app-message` `AppMessageRenderer`), which backs the app-wide confirm dialog. No file composes the parts directly.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// The parity reference is the APP's confirm modal (EnhancedModal): 16px content radius, a
// top-right close X, and a RED destructive Delete with a trash icon — NOT antd's raw defaults.
// So the antd side here mirrors the app: `styles.content.borderRadius=16` + `closable` +
// `okButtonProps={{danger}}` with the same lucide trash icon our destructive Button uses.
const ANT_MODAL_STYLES = {content: {borderRadius: 16}} as const
// `.ant-modal-footer` is `text-align: end` — an INLINE context, so its buttons baseline-align.
// With an icon in one button only that drops the icon-less Cancel 1px and adds a fractional
// descent to the panel height. Our DialogFooter is flex; align antd's so the row compares chrome.
const ANT_MODAL_STYLES_FLEX_FOOTER = {
    content: {borderRadius: 16},
    footer: {display: "flex", alignItems: "center", justifyContent: "flex-end"},
} as const
const okButtonProps = {danger: true, icon: <Trash2 size={14} />} as const

// Forced-OPEN state rendered INLINE (portal container) so the antd confirm modal and the
// agenta AlertDialog sit side by side for static comparison. A `transform` on the panel makes
// it the containing block for the fixed overlay + centered content, confining each to its column.
function Panel({render}: {render: (c: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative h-[360px] w-[560px] [transform:translateZ(0)]">
            {el && render(el)}
        </div>
    )
}

export const OpenState: Story = {
    render: () => (
        <div className="flex gap-16 p-4" data-open-compare>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntModal
                            open
                            getContainer={() => c}
                            // Resting-state comparison: antd's focus lock autofocuses the close X
                            // (4px colorPrimaryBorder ring) while the agenta side opts out below.
                            focusable={{trap: false}}
                            styles={ANT_MODAL_STYLES_FLEX_FOOTER}
                            title="Confirm deletion"
                            okText="Delete"
                            cancelText="Cancel"
                            okButtonProps={okButtonProps}
                            onCancel={() => {}}
                            onOk={() => {}}
                        >
                            <p>This action cannot be undone.</p>
                        </AntModal>
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
                <Panel
                    render={(c) => (
                        <AlertDialog open>
                            <AlertDialogContent
                                container={c}
                                onOpenAutoFocus={(e) => e.preventDefault()}
                                onCloseAutoFocus={(e) => e.preventDefault()}
                            >
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
                                </AlertDialogHeader>
                                <AlertDialogDescription>
                                    This action cannot be undone.
                                </AlertDialogDescription>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        className={buttonVariants({variant: "destructive"})}
                                    >
                                        <Trash2 className="size-3.5" />
                                        Delete
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                />
            </div>
        </div>
    ),
}

// Reference: real trigger-driven confirm dialogs (click to open) side by side.
export const AntdVsAgenta: Story = {
    render: function AntdVsAgentaStory() {
        const [antOpen, setAntOpen] = useState(false)
        return (
            <div className="flex gap-24 p-8">
                <div className="flex flex-col gap-2">
                    <span className="text-[10px] text-colorTextSecondary">antd</span>
                    <AntButton onClick={() => setAntOpen(true)}>Delete</AntButton>
                    <AntModal
                        open={antOpen}
                        styles={ANT_MODAL_STYLES}
                        title="Confirm deletion"
                        okText="Delete"
                        okButtonProps={okButtonProps}
                        onCancel={() => setAntOpen(false)}
                        onOk={() => setAntOpen(false)}
                    >
                        <p>This action cannot be undone.</p>
                    </AntModal>
                </div>
                <div className="flex flex-col gap-2">
                    <span className="text-[10px] text-colorTextSecondary">agenta</span>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <ShadButton variant="outline">Delete</ShadButton>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
                            </AlertDialogHeader>
                            <AlertDialogDescription>
                                This action cannot be undone.
                            </AlertDialogDescription>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    className={buttonVariants({variant: "destructive"})}
                                >
                                    <Trash2 className="size-3.5" />
                                    Delete
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
        )
    },
}
