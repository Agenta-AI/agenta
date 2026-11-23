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
                overlayClassName="bg-overlay supports-[backdrop-filter]:backdrop-blur-none"
                // The dialog box takes the focus on open, not the search, so no focus ring shows.
                onOpenAutoFocus={(event) => {
                    event.preventDefault()
                    ;(event.currentTarget as HTMLElement | null)?.focus()
                }}
                // 60 px from the top of the page (the positioner pads 16 px); a phone keeps the
                // kit's bottom dock (TOUCH-04).
                className="flex h-[min(80svh,560px)] max-w-content-md flex-col gap-0 overflow-hidden p-0 shadow-modal sm:mt-11 sm:h-[min(460px,calc(100%-44px))] sm:max-w-content-md sm:self-start sm:rounded-xl"
            >
                <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-border-muted px-4 py-3">
                    <DialogTitle className="m-0 flex-1 text-title">
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
                                className="text-muted-foreground"
                            />
                        }
                        size="sm"
                        className="w-60 gap-2 border-border-muted px-2 max-sm:w-40"
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
                        className="flex w-50 shrink-0 flex-col gap-1 overflow-y-auto border-0 border-r border-solid border-border-muted p-2 max-sm:w-auto max-sm:flex-row max-sm:overflow-x-auto max-sm:overflow-y-hidden max-sm:border-r-0 max-sm:border-b max-sm:[scrollbar-width:none]"
                    >
                        {(["all", ...IDEA_CATEGORIES] as const).map((key) => (
                            <button
                                key={key}
                                type="button"
                                role="tab"
                                aria-selected={category === key}
                                onClick={() => setCategory(key)}
                                className={cn(
                                    "focus-ring flex h-8 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border-0 px-3 text-left text-label text-foreground",
                                    category === key
                                        ? "bg-selected"
                                        : "bg-transparent hover:bg-accent",
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
                            <p className="m-0 px-1 py-1 text-body text-muted-foreground">
                                {t("builder.page.noIdeaMatches")}
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 content-start gap-2 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                                {ideas.map((entry) => (
                                    <button
                                        key={entry.key}
                                        type="button"
                                        data-testid="builder-idea"
                                        title={entry.prompt}
                                        onClick={() => onPick(entry.prompt)}
                                        className="focus-ring flex cursor-pointer flex-col gap-1 rounded-lg border border-solid border-border-muted bg-background px-3 py-2 text-left hover:bg-accent"
                                    >
                                        <span className="text-meta text-muted-foreground">
                                            {t(CATEGORY_LABELS[entry.category])}
                                        </span>
                                        <span className="text-label text-foreground">
                                            {entry.title}
                                        </span>
                                        <span className="text-meta text-muted-foreground">
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
