import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {MagnifyingGlassIcon, XIcon} from "@phosphor-icons/react"

const ICON_BUTTON =
    "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-colorTextSecondary [font-family:inherit] hover:bg-colorFillTertiary hover:text-colorText"

/** The search button at the right of the "Chats" heading. */
export const BuilderChatSearchButton = ({onOpen}: {onOpen: () => void}) => {
    const t = useT(commonCatalog)
    return (
        <button
            type="button"
            aria-label={t("common.search")}
            title={t("common.search")}
            data-testid="builder-chats-search"
            onClick={onOpen}
            // The glyph sits where the design puts it (12 px from the row's end), and the 24 px
            // target does not make the 20 px heading taller.
            className={`${ICON_BUTTON} -my-0.5 -mr-[5px]`}
        >
            <MagnifyingGlassIcon size={14} />
        </button>
    )
}

/**
 * The "Chats" heading row as a search field, with the cursor in it. It writes the term on a
 * debounce (the search is a server predicate). Escape or the x closes it and clears the term.
 */
export const BuilderChatSearchField = ({
    term,
    onTermChange,
    onClose,
}: {
    term: string
    onTermChange: (term: string) => void
    onClose: () => void
}) => {
    const t = useT(commonCatalog)
    const search = useDebouncedAtomSearch(onTermChange, 300, term)
    return (
        // -my-1 keeps the heading row's height: the list under it does not move.
        <div className="-my-1 flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-solid border-colorBorder bg-colorBgContainer pl-2 pr-0.5 focus-within:border-colorPrimary">
            <MagnifyingGlassIcon size={14} className="shrink-0 text-colorTextTertiary" />
            <input
                autoFocus
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key !== "Escape") return
                    event.preventDefault()
                    event.stopPropagation()
                    onClose()
                }}
                placeholder={t("common.search")}
                aria-label={t("common.search")}
                data-testid="builder-chats-search-field"
                className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-colorText outline-none [font-family:inherit] placeholder:text-colorTextTertiary"
            />
            <button
                type="button"
                aria-label={t("common.clearSearch")}
                title={t("common.clearSearch")}
                onClick={onClose}
                className={ICON_BUTTON}
            >
                <XIcon size={12} />
            </button>
        </div>
    )
}
