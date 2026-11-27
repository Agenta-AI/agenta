import {useEffect, useRef} from "react"

import {
    DEFAULT_PERMISSION_POLICY,
    type PermissionPolicy,
    type PermissionPolicyOption,
} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import chatPermissionsPickerPanelCatalog from "@agenta/i18n/catalogs/chat.permissionsPickerPanel"
import {Check, ShieldCheck} from "@phosphor-icons/react"

import {useRovingList} from "./useRovingList"

/** The `/permissions` picker: one click sets `runner.permissions.default`, leaving rules intact. */
const PermissionsPickerPanel = ({
    current,
    options,
    onApply,
    onDismiss,
    onBackToCommands,
    onOpenConfig,
}: {
    current: PermissionPolicy | null
    /** Only what this agent's schema permits — the drawer filters the same way. */
    options: PermissionPolicyOption[]
    onApply: (policy: PermissionPolicy) => void
    /** Drop the picker. The reason decides whether focus goes back to the composer. */
    onDismiss: (reason: "escape" | "outside") => void
    /** Step back one level: the host restores the `/` this picker consumed. */
    onBackToCommands: () => void
    /** Omitted where the host has no config surface to send you to (mobile). */
    onOpenConfig?: () => void
}) => {
    const applied = current ?? DEFAULT_PERMISSION_POLICY
    // Arrows move, Enter applies — no confirmation keystroke, matching the one-click mouse model.
    const {containerProps, optionProps} = useRovingList({
        items: options,
        current: options.find((option) => option.value === applied) ?? null,
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

    const t = useT(chatPermissionsPickerPanelCatalog)
    return (
        <div
            ref={rootRef}
            className="overflow-hidden rounded-lg border border-solid border-border-muted bg-popover shadow-overlay outline-none"
        >
            <div className="flex items-center gap-2 border-0 border-b border-solid border-border-muted px-3 py-2.5">
                <ShieldCheck size={14} className="text-muted-foreground" />
                <span className="text-label text-foreground">
                    {t("chat.permissionsPickerPanel.title")}
                </span>
                <span className="truncate text-meta text-muted-foreground">
                    {t("chat.permissionsPickerPanel.subtitle")}
                </span>
                <span className="ml-auto shrink-0 font-mono text-caption text-muted-foreground">
                    /permissions
                </span>
            </div>

            <div
                {...containerProps}
                aria-label={t("chat.permissionsPickerPanel.policyLabel")}
                className="py-1 outline-none"
            >
                {options.map((option, index) => {
                    const isApplied = option.value === applied
                    return (
                        <div
                            key={option.value}
                            {...optionProps(index)}
                            aria-selected={isApplied}
                            onClick={() => onApply(option.value)}
                            className="mx-1 flex cursor-pointer items-center rounded-sm px-2.5 py-2 data-[active=true]:bg-accent"
                        >
                            <span className="min-w-0">
                                <span className="block text-label leading-snug text-foreground">
                                    {option.label}
                                </span>
                                <span className="block text-meta leading-snug text-muted-foreground">
                                    {option.help}
                                </span>
                            </span>
                            {isApplied ? (
                                <Check
                                    size={13}
                                    className="ml-auto shrink-0 pl-2.5 text-muted-foreground"
                                />
                            ) : null}
                        </div>
                    )
                })}
            </div>

            <div className="flex items-center gap-1.5 border-0 border-t border-solid border-border-muted bg-secondary px-3 py-2 text-meta text-muted-foreground">
                <span>{t("chat.permissionsPickerPanel.changesDraft")}</span>
                {onOpenConfig ? (
                    <button
                        type="button"
                        onClick={onOpenConfig}
                        className="cursor-pointer border-none bg-transparent p-0 text-meta text-link underline"
                    >
                        {t("chat.permissionsPickerPanel.editRules")}
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={onBackToCommands}
                    className="ml-auto flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-meta text-muted-foreground"
                >
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-secondary px-1 font-mono text-caption font-medium text-muted-foreground">
                        ←
                    </span>
                    {t("chat.permissionsPickerPanel.backToCommands")}
                </button>
            </div>
        </div>
    )
}

export default PermissionsPickerPanel
