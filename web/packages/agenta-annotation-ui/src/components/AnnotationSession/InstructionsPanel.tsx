/**
 * InstructionsPanel
 *
 * Popover trigger for the queue's description/instructions.
 * Keeping the instructions in an overlay avoids pushing the session layout down.
 */

import {memo, useState} from "react"

import {CaretDown, Info} from "@phosphor-icons/react"
import {Popover, Typography} from "antd"

interface InstructionsPanelProps {
    instructions: string
}

const InstructionsPanel = memo(function InstructionsPanel({instructions}: InstructionsPanelProps) {
    const [open, setOpen] = useState(false)

    return (
        <div className="border-b border-solid border-[var(--ant-color-border-secondary)]">
            <Popover
                trigger="click"
                open={open}
                onOpenChange={setOpen}
                placement="bottomLeft"
                destroyOnHidden
                styles={{body: {padding: 0}} as Record<string, React.CSSProperties>}
                content={
                    <div
                        className="overflow-y-auto px-4 py-3"
                        style={{
                            width: "min(640px, calc(100vw - 32px))",
                            maxHeight: "min(320px, calc(100vh - 160px))",
                        }}
                    >
                        <Typography.Text className="block whitespace-pre-wrap text-sm leading-6 text-[var(--ant-color-text)]">
                            {instructions}
                        </Typography.Text>
                    </div>
                }
            >
                <button
                    type="button"
                    aria-expanded={open}
                    className="flex items-center gap-2 w-full px-4 py-2 text-left bg-[var(--ant-color-fill-quaternary)] hover:bg-[var(--ant-color-fill-tertiary)] transition-colors cursor-pointer border-none"
                >
                    <Info size={14} className="shrink-0 text-[#758391]" />
                    <Typography.Text type="secondary" className="text-xs font-medium flex-1">
                        Instructions
                    </Typography.Text>
                    <CaretDown
                        size={12}
                        className={`text-[#758391] transition-transform ${open ? "rotate-180" : ""}`}
                    />
                </button>
            </Popover>
        </div>
    )
})

export default InstructionsPanel
