import {useEffect, useRef} from "react"

import {
    DEFAULT_PERMISSION_POLICY,
    PERMISSION_POLICY_OPTIONS,
    type PermissionPolicy,
} from "@agenta/entity-ui/drill-in"
import {Check, ShieldCheck} from "@phosphor-icons/react"

import {useRovingList} from "./useRovingList"

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
    /** Drop the picker. The reason decides whether focus goes back to the composer. */
    onDismiss: (reason: "escape" | "outside") => void
    /** Step back one level: the host restores the `/` this picker consumed. */
    onBackToCommands: () => void
    onOpenConfig: () => void
}) => {
    const applied = current ?? DEFAULT_PERMISSION_POLICY
    // Arrows move, Enter applies — no confirmation keystroke, matching the one-click mouse model.
    const {containerProps, optionProps} = useRovingList({
        items: PERMISSION_POLICY_OPTIONS,
        current: PERMISSION_POLICY_OPTIONS.find((option) => option.value === applied) ?? null,
        onEnter: (option) => onApply(option.value),
        onBack: onBackToCommands,
    })
    // Two different elements: the listbox is the option list, but a click anywhere in the panel
    // (header, footer) is still "inside" for dismissal.
    const rootRef = useRef<HTMLDivElement | null>(null)

    // No trigger to toggle it and nothing above it dismisses it, so the panel owns that itself.
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            const node = event.target as Node | null
            if (node && rootRef.current?.contains(node)) return
            onDismiss("outside")
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onDismiss("escape")
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
            className="overflow-hidden rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgElevated)] shadow-[0_14px_36px_rgba(28,44,61,.14),0_2px_6px_rgba(28,44,61,.06)] outline-none"
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

            <div
                {...containerProps}
                aria-label="Permission policy"
                className="py-[5px] outline-none"
            >
                {PERMISSION_POLICY_OPTIONS.map((option, index) => {
                    const isApplied = option.value === applied
                    return (
                        <div
                            key={option.value}
                            {...optionProps(index)}
                            aria-selected={isApplied}
                            onClick={() => onApply(option.value)}
                            className="mx-[5px] flex cursor-pointer items-center rounded-md px-2.5 py-[7px] data-[active=true]:bg-[var(--ag-colorFillTertiary)]"
                        >
                            <span className="min-w-0">
                                <span className="block text-[12.5px] leading-snug text-[var(--ag-colorText)]">
                                    {option.label}
                                </span>
                                <span className="block text-[11.5px] leading-snug text-[var(--ag-colorTextTertiary)]">
                                    {option.help}
                                </span>
                            </span>
                            {isApplied ? (
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
                    className="ml-auto flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-[10.5px] text-[var(--ag-colorTextTertiary)]"
                >
                    <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-[3px] bg-[var(--ag-colorFillTertiary)] px-1 font-mono text-[9.5px] font-medium text-[var(--ag-colorTextSecondary)]">
                        ←
                    </span>
                    back to commands
                </button>
            </div>
        </div>
    )
}

export default PermissionsPickerPanel
