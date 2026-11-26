import {useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Button, Dialog, DialogClose, DialogContent, DialogTitle, SearchInput} from "@agenta/ui/ui"
import {MagnifyingGlass, X} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {CATEGORY_LABELS, filterIdeas, IDEA_CATEGORIES, IDEAS, type IdeaCategory} from "./ideas"

/**
 * "More ideas" (B02): a search field, the categories and the ready prompts as cards. A pick puts
 * the prompt in the composer and closes the dialog; nothing is sent.
 */
export const MoreIdeasDialog = ({
    open,
    onOpenChange,
    onPick,
    container,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onPick: (prompt: string) => void
    /** The page beside the sidebar: the dialog and its mask cover it, not the whole window. */
    container: HTMLElement | null
}) => {
    const t = useT(builderPageCatalog, commonCatalog)
    const [category, setCategory] = useState<IdeaCategory | "all">("all")
    const [search, setSearch] = useState("")
    const ideas = useMemo(
        () =>
            filterIdeas(
                IDEAS.map((entry) => ({
                    key: entry.title,
                    category: entry.category,
                    title: t(entry.title),
                    line: t(entry.line),
                    prompt: t(entry.prompt),
                })),
                category,
                search,
            ),
        [category, search, t],
    )
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-testid="builder-ideas"
                container={container}
                showCloseButton={false}
                // A flat 25 % dim with no blur (B02).
                overlayClassName="bg-black/25 supports-[backdrop-filter]:backdrop-blur-none"
                // The dialog box takes the focus on open, not the search, so no focus ring shows.
                onOpenAutoFocus={(event) => {
                    event.preventDefault()
                    ;(event.currentTarget as HTMLElement | null)?.focus()
                }}
                // 60 px from the top of the page: the positioner pads 16 px.
                className="mt-11 flex h-[min(460px,calc(100%-44px))] max-w-[760px] flex-col gap-0 self-start overflow-hidden rounded-[12px] p-0 shadow-dialog sm:max-w-[760px]"
            >
                <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-4 py-3.5">
                    <DialogTitle className="m-0 flex-1 text-sm font-semibold">
                        {t("builder.page.moreIdeas")}
                    </DialogTitle>
                    <SearchInput
                        aria-label={t("builder.page.searchIdeas")}
                        placeholder={t("builder.page.searchIdeas")}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        // B02: a tertiary glyph 8 px in, 8 px before the text. The prefix is the
                        // default glyph; passing it is how its color is set.
                        prefix={
                            <MagnifyingGlass
                                aria-hidden
                                size={14}
                                className="text-colorTextTertiary"
                            />
                        }
                        className="h-[30px] w-60 gap-2 rounded-[6px] border-colorBorderSecondary px-2 text-[13px] max-sm:w-40 md:text-[13px]"
                    />
                    <DialogClose asChild>
                        <Button
                            variant="ghost"
                            size="icon-compact"
                            aria-label={t("common.close")}
                            className="shrink-0"
                        >
                            <X aria-hidden />
                        </Button>
                    </DialogClose>
                </div>
                {/* A phone shows the categories as one row that scrolls sideways, above the cards. */}
                <div className="flex min-h-0 flex-1 max-sm:flex-col">
                    <div
                        role="tablist"
                        className="flex w-[200px] shrink-0 flex-col gap-[5px] overflow-y-auto border-0 border-r border-solid border-colorBorderSecondary p-2 max-sm:w-auto max-sm:flex-row max-sm:overflow-x-auto max-sm:overflow-y-hidden max-sm:border-r-0 max-sm:border-b max-sm:[scrollbar-width:none]"
                    >
                        {(["all", ...IDEA_CATEGORIES] as const).map((key) => (
                            <button
                                key={key}
                                type="button"
                                role="tab"
                                aria-selected={category === key}
                                onClick={() => setCategory(key)}
                                className={cn(
                                    "flex h-8 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-[6px] border-0 px-3 text-left text-[13px] leading-5 text-colorText max-sm:h-11",
                                    category === key
                                        ? "bg-colorBgContainer font-medium ring-1 ring-inset ring-colorBorderSecondary"
                                        : "bg-transparent hover:bg-colorFillTertiary",
                                )}
                            >
                                <span className="truncate max-sm:overflow-visible">
                                    {t(CATEGORY_LABELS[key])}
                                </span>
                            </button>
                        ))}
                    </div>
                    <div className="min-w-0 flex-1 overflow-y-auto p-3">
                        {ideas.length === 0 ? (
                            <p className="m-0 px-1 py-1 text-[13px] text-colorTextSecondary">
                                {t("builder.page.noIdeaMatches")}
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 content-start gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                                {ideas.map((entry) => (
                                    <button
                                        key={entry.key}
                                        type="button"
                                        data-testid="builder-idea"
                                        title={entry.prompt}
                                        onClick={() => onPick(entry.prompt)}
                                        className="flex cursor-pointer flex-col gap-1 rounded-[10px] border border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-2.5 text-left hover:bg-colorFillTertiary"
                                    >
                                        <span className="text-[11px] leading-4 text-colorTextTertiary">
                                            {t(CATEGORY_LABELS[entry.category])}
                                        </span>
                                        <span className="text-[13px] font-semibold leading-5 text-colorText">
                                            {entry.title}
                                        </span>
                                        <span className="text-[12px] leading-4 text-colorTextSecondary">
                                            {entry.line}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
