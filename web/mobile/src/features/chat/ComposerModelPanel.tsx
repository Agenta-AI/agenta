import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type RefObject,
} from "react"

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
    triggerRef,
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
    /** The model button: a press on it is its own toggle, not a press outside. */
    triggerRef?: RefObject<HTMLElement | null>
}) => {
    const t = useT(chatMobileComposerCatalog, uiLlmProviderCatalog)
    const rootRef = useRef<HTMLDivElement | null>(null)
    // No trigger owns this list, so it closes itself on Escape and on a press outside it.
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            const node = event.target as Node | null
            if (node && rootRef.current?.contains(node)) return
            if (node && triggerRef?.current?.contains(node)) return
            onDismiss("outside")
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return
            // This Escape is the list's: the chat's own Escape (Stop) must not see it too.
            event.preventDefault()
            onDismiss("escape")
        }
        // Capture, so a handler that stops propagation cannot keep the list open.
        document.addEventListener("pointerdown", onPointerDown, true)
        document.addEventListener("keydown", onKeyDown, true)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true)
            document.removeEventListener("keydown", onKeyDown, true)
        }
    }, [onDismiss, triggerRef])
    // A touch keyboard would cover the list, so the caret goes to the search only with a mouse.
    const [finePointer] = useState(
        () => typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches,
    )
    // The current model in view when the list opens, as the design draws it.
    useEffect(() => {
        rootRef.current
            ?.querySelector<HTMLElement>("li button[aria-pressed=true]")
            ?.scrollIntoView({block: "nearest"})
        // With no caret in the search, the list itself takes focus, so a keyboard attached to a
        // tablet can still walk it. A focused list opens no touch keyboard.
        if (!finePointer) rootRef.current?.focus({preventScroll: true})
    }, [finePointer])

    // Up and Down walk the search field and the rows; Enter presses the focused row. Left in an
    // empty search goes back to the commands when `/model` opened the list.
    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const root = rootRef.current
        if (!root) return
        const search = root.querySelector<HTMLInputElement>("input")
        if (
            event.key === "ArrowLeft" &&
            onBackToCommands &&
            event.target === search &&
            !search?.value
        ) {
            event.preventDefault()
            onBackToCommands()
            return
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        const stops = [
            ...(search ? [search] : []),
            ...root.querySelectorAll<HTMLElement>("li button:not(:disabled)"),
        ]
        const at = stops.indexOf(document.activeElement as HTMLElement)
        const next = event.key === "ArrowDown" ? at + 1 : at - 1
        if (next < 0 || next >= stops.length) return
        event.preventDefault()
        stops[next].focus()
        stops[next].scrollIntoView({block: "nearest"})
    }

    return (
        <div
            ref={rootRef}
            onKeyDown={onKeyDown}
            role="dialog"
            tabIndex={-1}
            // An open layer for the chat's shortcuts (`isOverlayOpen`), as a Radix popover is.
            data-state="open"
            aria-label={t("chat.mobileComposer.searchModels")}
            className="bg-popover text-popover-foreground shadow-overlay flex outline-none max-h-[min(540px,60dvh)] flex-col rounded-xl p-1.5"
        >
            <ModelPickerList
                options={groups}
                selectedKey={selectedKey}
                value={value}
                onChange={onPick}
                searchPlaceholder={t("chat.mobileComposer.searchModels")}
                searchSuffix="/model"
                autoFocusSearch={finePointer}
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
