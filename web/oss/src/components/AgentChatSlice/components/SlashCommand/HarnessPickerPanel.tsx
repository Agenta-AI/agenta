import {useEffect, useRef} from "react"

import type {HarnessCapabilitiesMap} from "@agenta/entities/workflow"
import {
    allowedDeployments,
    allowedProviders,
    buildModelOptionGroups,
    harnessAllowsModel,
    harnessMetaFor,
    modelLabel,
    type HarnessMeta,
} from "@agenta/entity-ui/drill-in"
import {Cube} from "@phosphor-icons/react"
import {Button} from "antd"

import {useRovingList} from "./useRovingList"

/**
 * The `/harness` picker: the harness list on the left, the highlighted one's detail on the right.
 * Mirrors the config drawer's harness rail (providers / hosting / model compatibility) rather than
 * reusing `HarnessSelectControl`, which is a schema-bound combobox with no detail pane.
 *
 * Switching to a harness that cannot reach the current model moves the model too — the drawer only
 * flags the mismatch, but in chat an unreachable model reads as a silent failure on the next send.
 */
const HarnessPickerPanel = ({
    harnessIds,
    capabilities,
    currentHarness,
    currentModel,
    onApply,
    onDismiss,
    onBackToCommands,
    onOpenConfig,
}: {
    harnessIds: string[]
    capabilities: HarnessCapabilitiesMap | null
    currentHarness: string | null
    currentModel: string | null
    onApply: (kind: string) => void
    /** Drop the picker. The reason decides whether focus goes back to the composer. */
    onDismiss: (reason: "escape" | "outside") => void
    /** Step back one level: the host restores the `/` this picker consumed. */
    onBackToCommands: () => void
    onOpenConfig: () => void
}) => {
    // Arrows move the rail and the detail pane follows, so the stranding warning is already on
    // screen when Enter lands — no confirmation keystroke. Enter is the shortcut for "Use ⟨name⟩".
    const {activeIndex, setActiveIndex, containerProps, optionProps} = useRovingList({
        items: harnessIds,
        current: currentHarness,
        onEnter: (id) => {
            if (id !== currentHarness) onApply(id)
        },
        onBack: onBackToCommands,
    })
    const selected = harnessIds[activeIndex] ?? null
    // Two different elements: the listbox is the rail, but a click anywhere in the panel (detail
    // pane, footer) is still "inside" for dismissal.
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

    const meta: HarnessMeta | null = selected ? harnessMetaFor(selected) : null
    const providers = selected ? allowedProviders(capabilities, selected) : []
    const deployments = selected ? allowedDeployments(capabilities, selected) : []
    const modelCount = selected
        ? buildModelOptionGroups(capabilities, selected).reduce(
              (n, group) => n + group.options.length,
              0,
          )
        : 0
    const keepsModel = harnessAllowsModel(capabilities, selected, currentModel)
    const fallback = keepsModel
        ? null
        : (buildModelOptionGroups(capabilities, selected)[0]?.options[0] ?? null)
    const isCurrent = !!selected && selected === currentHarness
    const currentModelLabel =
        modelLabel(capabilities, currentHarness, currentModel) ?? currentModel ?? "your model"

    const summary = (values: string[]) => {
        const named = values.filter((value) => value !== "*")
        if (!named.length) return "any"
        const head = named.slice(0, 4).join(" · ")
        return named.length > 4 ? `${head} +${named.length - 4}` : head
    }

    return (
        <div
            ref={rootRef}
            className="overflow-hidden rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgElevated)] shadow-[0_14px_36px_rgba(28,44,61,.14),0_2px_6px_rgba(28,44,61,.06)]"
        >
            <div className="flex items-center gap-2 border-0 border-b border-solid border-[var(--ag-colorBorderSecondary)] px-[13px] py-2.5">
                <Cube size={14} className="text-[var(--ag-colorSuccess)]" />
                <span className="text-xs font-medium text-[var(--ag-colorText)]">Harness</span>
                <span className="truncate text-[11.5px] text-[var(--ag-colorTextTertiary)]">
                    the runtime that executes your agent
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-[var(--ag-colorTextTertiary)]">
                    /harness
                </span>
            </div>

            <div className="flex">
                <div
                    {...containerProps}
                    aria-label="Harness"
                    className="w-[214px] shrink-0 overflow-y-auto border-0 border-r border-solid border-[var(--ag-colorBorderSecondary)] py-[5px] outline-none"
                >
                    {harnessIds.map((id, index) => {
                        const item = harnessMetaFor(id)
                        return (
                            <div
                                key={id}
                                {...optionProps(index)}
                                aria-selected={id === currentHarness}
                                onClick={() => setActiveIndex(index)}
                                className="mx-[5px] flex cursor-pointer items-center gap-[9px] rounded-md px-2 py-[7px] data-[active=true]:bg-[var(--ag-colorFillTertiary)]"
                            >
                                <span
                                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold leading-none text-white"
                                    style={{background: item.color}}
                                >
                                    {item.short}
                                </span>
                                <span className="truncate text-xs text-[var(--ag-colorText)]">
                                    {item.label}
                                </span>
                                {id === currentHarness ? (
                                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                                ) : null}
                            </div>
                        )
                    })}
                </div>

                {/* Keyed on the selection so picking another harness crossfades the detail rather
                    than swapping every line at once. Opacity only — this is text being read to
                    make a decision, so it must not move. */}
                <div
                    key={selected}
                    className="flex min-w-0 flex-1 animate-command-panel-swap flex-col px-4 py-3.5"
                >
                    <div className="flex items-center gap-[9px]">
                        <span className="text-sm font-semibold text-[var(--ag-colorText)]">
                            {meta?.label ?? "—"}
                        </span>
                        {isCurrent ? (
                            <span className="rounded-full bg-[var(--ag-colorFillTertiary)] px-2 py-0.5 text-[11px] text-[var(--ag-colorTextSecondary)]">
                                Current
                            </span>
                        ) : null}
                        <span
                            className="text-xs"
                            style={{
                                color: keepsModel
                                    ? "var(--ag-colorSuccess)"
                                    : "var(--ag-colorWarning)",
                            }}
                        >
                            {keepsModel ? "✓ supports your model" : "model not available"}
                        </span>
                    </div>

                    <div className="mt-3 text-[9.5px] font-semibold uppercase tracking-[.1em] text-[var(--ag-colorTextTertiary)]">
                        Providers
                    </div>
                    <div className="mt-1 text-xs text-[var(--ag-colorTextSecondary)]">
                        {summary(providers)}
                        {modelCount ? ` · ${modelCount} models` : ""}
                    </div>

                    <div className="mt-[11px] text-[9.5px] font-semibold uppercase tracking-[.1em] text-[var(--ag-colorTextTertiary)]">
                        Hosting
                    </div>
                    <div className="mt-1 text-xs text-[var(--ag-colorTextSecondary)]">
                        {summary(deployments)}
                    </div>

                    <div className="mt-3 min-h-[52px]">
                        {fallback && meta ? (
                            <div className="rounded-md bg-[var(--ag-colorWarningBg)] px-2.5 py-2 text-[11.5px] leading-normal text-[var(--ag-colorWarningText)]">
                                {meta.label} can&apos;t run {currentModelLabel}. Switching moves
                                this agent to {fallback.label}.
                            </div>
                        ) : null}
                    </div>

                    <div className="mt-auto flex items-center gap-2 pt-2">
                        {isCurrent ? (
                            <Button size="small" disabled>
                                Already in use
                            </Button>
                        ) : (
                            <Button
                                size="small"
                                type="primary"
                                onClick={() => selected && onApply(selected)}
                                disabled={!selected}
                            >
                                Use {meta?.label ?? "harness"}
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-1.5 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] px-[13px] py-[7px] text-[10.5px] text-[var(--ag-colorTextTertiary)]">
                <span>Changes this agent&apos;s draft config.</span>
                <button
                    type="button"
                    onClick={onOpenConfig}
                    className="cursor-pointer border-none bg-transparent p-0 text-[10.5px] text-[var(--ag-colorPrimary)]"
                >
                    Open config →
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

export default HarnessPickerPanel
