import {useEffect, useRef} from "react"

import {useT} from "@agenta/i18n"
import chatMobileComposerCatalog from "@agenta/i18n/catalogs/chat.mobileComposer"
import uiLlmProviderCatalog from "@agenta/i18n/catalogs/ui.llmProvider"
import {
    ModelPickerList,
    type ProviderGroup,
    type ProviderOption,
} from "@agenta/ui/select-llm-provider"
import {Button} from "@agenta/ui/ui"
import {Faders} from "@phosphor-icons/react"

/**
 * The composer's model list (canvas page 8): one list grouped by connection, each model with its
 * raw id, a check on the current one, and "Manage model providers" at the end. It opens above
 * the composer from the model button or from `/model`, and only `/model` offers the way back to
 * the commands.
 */
export const ComposerModelPanel = ({
    groups,
    selectedKey,
    value,
    onPick,
    onDismiss,
    onManageProviders,
    onBackToCommands,
}: {
    groups: ProviderGroup[]
    selectedKey: string | null | undefined
    value: string | null | undefined
    onPick: (value: string, option: ProviderOption) => void
    /** Drop the list. The reason decides whether focus goes back to the composer. */
    onDismiss: (reason: "escape" | "outside") => void
    onManageProviders: () => void
    /** Only when `/model` opened the list. */
    onBackToCommands?: () => void
}) => {
    const t = useT(chatMobileComposerCatalog, uiLlmProviderCatalog)
    const rootRef = useRef<HTMLDivElement | null>(null)
    // No trigger owns this list, so it closes itself on Escape and on a press outside it.
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            const node = event.target as Node | null
            if (node && rootRef.current?.contains(node)) return
            onDismiss("outside")
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onDismiss("escape")
        }
        // Capture, so a handler that stops propagation cannot keep the list open.
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
            role="dialog"
            aria-label={t("chat.mobileComposer.searchModels")}
            className="bg-popover text-popover-foreground shadow-overlay flex max-h-[min(540px,60dvh)] flex-col rounded-xl p-1.5"
        >
            <ModelPickerList
                options={groups}
                selectedKey={selectedKey}
                value={value}
                onChange={onPick}
                searchPlaceholder={t("chat.mobileComposer.searchModels")}
                searchSuffix="/model"
                autoFocusSearch
                panelFooter={
                    <div className="border-border border-0 border-t border-solid pt-2">
                        <Button variant="outline" className="w-full" onClick={onManageProviders}>
                            <Faders size={14} />
                            {t("ui.llmProvider.manageProviders")}
                        </Button>
                    </div>
                }
            />
            {onBackToCommands ? (
                <div className="flex justify-end px-1 pt-1.5">
                    <button
                        type="button"
                        onClick={onBackToCommands}
                        className="text-muted-foreground cursor-pointer border-none bg-transparent p-0 text-[10.5px]"
                    >
                        {t("chat.mobileComposer.backToCommands")}
                    </button>
                </div>
            ) : null}
        </div>
    )
}
