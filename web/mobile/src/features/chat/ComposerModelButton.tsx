import {useRef} from "react"

import {useT} from "@agenta/i18n"
import chatMobileComposerCatalog from "@agenta/i18n/catalogs/chat.mobileComposer"
import {getProviderIcon, type ProviderGroup} from "@agenta/ui/select-llm-provider"
import {CaretDown} from "@phosphor-icons/react"

import {selectedModelOf} from "./selectedModelOf"

/**
 * The composer's model button, left of Send: the provider logo, the model name and a caret. It
 * opens the model list of `/model`. A long name is cut with "…". On a phone the hit area grows to
 * 44 px; the button itself stays 28 px, so the composer row keeps its height.
 */
export const ComposerModelButton = ({
    groups,
    selectedKey,
    modelId,
    open,
    disabled,
    onOpen,
    onClose,
}: {
    groups: ProviderGroup[]
    selectedKey: string | null | undefined
    modelId: string
    /** The list is open: the button shows its pressed fill. */
    open: boolean
    disabled?: boolean
    onOpen: () => void
    onClose: () => void
}) => {
    const t = useT(chatMobileComposerCatalog)
    // A press while the list is open closes it first (a pointer-down outside the list), so the
    // click must read the state from the press, not from now. A keyboard click has no press.
    const openAtPressRef = useRef(false)
    const selected = selectedModelOf(groups, selectedKey, modelId)
    const label = selected?.label ?? modelId
    const Logo = selected ? getProviderIcon(selected.iconKey) : null
    return (
        <button
            type="button"
            onPointerDown={() => {
                openAtPressRef.current = open
            }}
            onClick={(event) => {
                const wasOpen = event.detail === 0 ? open : openAtPressRef.current
                openAtPressRef.current = false
                if (wasOpen) onClose()
                else onOpen()
            }}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={t("chat.mobileComposer.modelButton", {model: label})}
            title={label}
            data-state={open ? "open" : "closed"}
            className="text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground relative inline-flex h-7 max-w-[220px] min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent pr-1.5 pl-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-60 max-md:before:absolute max-md:before:inset-x-0 max-md:before:-inset-y-2 max-md:before:content-['']"
        >
            {Logo ? (
                <span className="text-foreground inline-flex size-3.5 shrink-0" aria-hidden>
                    <Logo className="size-3.5" />
                </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <CaretDown size={12} className="text-colorTextTertiary shrink-0" aria-hidden />
        </button>
    )
}
