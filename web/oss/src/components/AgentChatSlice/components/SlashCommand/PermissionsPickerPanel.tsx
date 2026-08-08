import {useEffect, useRef} from "react"

import {
    DEFAULT_PERMISSION_POLICY,
    PERMISSION_POLICY_OPTIONS,
    type PermissionPolicy,
} from "@agenta/entity-ui/drill-in"
import {Check, ShieldCheck} from "@phosphor-icons/react"

/**
 * The `/permissions` picker: the four default policies with their descriptions, nothing else.
 *
 * One click applies — no detail pane and no commit step, unlike `/harness`. Rule editing stays in
 * the config drawer; this only sets `runner.permissions.default`, so the rules beside it survive.
 */
const PermissionsPickerPanel = ({
    current,
    onApply,
    onDismiss,
    onBackToCommands,
    onOpenConfig,
}: {
    current: PermissionPolicy | null
    onApply: (policy: PermissionPolicy) => void
    /** Escape / a click outside — drop the picker and leave the composer as it is. */
    onDismiss: () => void
    /** Step back one level: the host restores the `/` this picker consumed. */
    onBackToCommands: () => void
    onOpenConfig: () => void
}) => {
    const rootRef = useRef<HTMLDivElement | null>(null)
    const active = current ?? DEFAULT_PERMISSION_POLICY

    // No trigger to toggle it and nothing above it dismisses it, so the panel owns that itself.
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            const node = event.target as Node | null
            if (node && rootRef.current?.contains(node)) return
            onDismiss()
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onDismiss()
        }
        // Capture, so a handler that stops propagation cannot strand the panel open.
        document.addEventListener("pointerdown", onPointerDown, true)
        document.addEventListener("keydown", onKeyDown, true)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true)
            document.removeEventListener("keydown", onKeyDown, true)
        }
    }, [onDismiss])

    return (
        <div
            ref={rootRef}
            role="listbox"
            aria-label="Permission policy"
            className="overflow-hidden rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgElevated)] shadow-[0_14px_36px_rgba(28,44,61,.14),0_2px_6px_rgba(28,44,61,.06)]"
        >
            <div className="flex items-center gap-2 border-0 border-b border-solid border-[var(--ag-colorBorderSecondary)] px-[13px] py-2.5">
                <ShieldCheck size={14} className="text-[var(--ag-colorSuccess)]" />
                <span className="text-xs font-medium text-[var(--ag-colorText)]">Permissions</span>
                <span className="truncate text-[11.5px] text-[var(--ag-colorTextTertiary)]">
                    what the agent may do before it must ask
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-[var(--ag-colorTextTertiary)]">
                    /permissions
                </span>
            </div>

            <div className="py-[5px]">
                {PERMISSION_POLICY_OPTIONS.map((option) => {
                    const selected = option.value === active
                    return (
                        <div
                            key={option.value}
                            role="option"
                            aria-selected={selected}
                            onClick={() => onApply(option.value)}
                            className={`mx-[5px] flex cursor-pointer items-center rounded-md px-2.5 py-[7px] ${
                                selected ? "bg-[var(--ag-colorFillTertiary)]" : ""
                            }`}
                        >
                            <span className="min-w-0">
                                <span className="block text-[12.5px] leading-snug text-[var(--ag-colorText)]">
                                    {option.label}
                                </span>
                                <span className="block text-[11.5px] leading-snug text-[var(--ag-colorTextTertiary)]">
                                    {option.help}
                                </span>
                            </span>
                            {selected ? (
                                <Check
                                    size={13}
                                    className="ml-auto shrink-0 pl-2.5 text-[var(--ag-colorTextSecondary)]"
                                />
                            ) : null}
                        </div>
                    )
                })}
            </div>

            <div className="flex items-center gap-1.5 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] px-[13px] py-[7px] text-[10.5px] text-[var(--ag-colorTextTertiary)]">
                <span>Changes this agent&apos;s draft config.</span>
                <button
                    type="button"
                    onClick={onOpenConfig}
                    className="cursor-pointer border-none bg-transparent p-0 text-[10.5px] text-[var(--ag-colorPrimary)]"
                >
                    Edit rules in config →
                </button>
                <button
                    type="button"
                    onClick={onBackToCommands}
                    className="ml-auto cursor-pointer border-none bg-transparent p-0 text-[10.5px] text-[var(--ag-colorTextTertiary)]"
                >
                    ← back to commands
                </button>
            </div>
        </div>
    )
}

export default PermissionsPickerPanel
