import {useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Button, Dialog, DialogClose, DialogContent, DialogTitle, SearchInput} from "@agenta/ui/ui"
import {
    Book,
    ChartBar,
    Chat,
    ClockCounterClockwise,
    Lightning,
    List,
    Sparkle,
    SlidersHorizontal,
    Users,
    Wrench,
    X,
    type Icon,
} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {
    CATEGORY_LABELS,
    filterIdeas,
    IDEA_CATEGORIES,
    IDEAS,
    type IdeaCategory,
    type PageKey,
} from "./ideas"

const CATEGORY_ICONS: Record<IdeaCategory | "all", Icon> = {
    all: List,
    gettingStarted: Sparkle,
    support: Chat,
    sales: Users,
    operations: ClockCounterClockwise,
    engineering: Wrench,
    improve: SlidersHorizontal,
    test: ChartBar,
    automations: Lightning,
}

/** Ideas whose icon is not their category's (B02). */
const IDEA_ICONS: Partial<Record<PageKey, Icon>> = {
    "builder.page.ideaHelpCenter": Book,
}

/**
 * "Browse ideas" (B02): a search field, the categories and the ready prompts. A pick puts the
 * prompt in the composer and closes the dialog; nothing is sent.
 */
export const BrowseIdeasDialog = ({
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
                // The dialog itself takes the focus, so no field shows a focus ring on open.
                onOpenAutoFocus={(event) => event.preventDefault()}
                // 60 px from the top of the page: the positioner pads 16 px.
                className="mt-11 flex h-[460px] max-w-[760px] flex-col gap-0 self-start overflow-hidden rounded-[12px] p-0 shadow-[0_20px_50px_rgba(0,0,0,0.18)] sm:max-w-[760px]"
            >
                <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-4 py-3.5">
                    <DialogTitle className="m-0 flex-1 text-sm font-semibold">
                        {t("builder.page.browseIdeas")}
                    </DialogTitle>
                    <SearchInput
                        aria-label={t("builder.page.searchIdeas")}
                        placeholder={t("builder.page.searchIdeas")}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        className="h-[30px] w-60 rounded-[6px] border-colorBorderSecondary text-[13px] max-sm:w-40 md:text-[13px]"
                    />
                    <DialogClose asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("common.close")}
                            className="shrink-0 text-colorTextSecondary"
                        >
                            <X aria-hidden size={16} />
                        </Button>
                    </DialogClose>
                </div>
                <div className="flex min-h-0 flex-1">
                    <div
                        role="tablist"
                        aria-orientation="vertical"
                        className="flex w-[210px] shrink-0 flex-col gap-[5px] overflow-y-auto border-0 border-r border-solid border-colorBorderSecondary p-2 max-sm:w-36"
                    >
                        {(["all", ...IDEA_CATEGORIES] as const).map((key) => {
                            const CategoryIcon = CATEGORY_ICONS[key]
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    role="tab"
                                    aria-selected={category === key}
                                    onClick={() => setCategory(key)}
                                    className={cn(
                                        "flex h-8 shrink-0 cursor-pointer items-center gap-2.5 rounded-[6px] border-0 px-3 text-left text-[13px] leading-5 text-colorText",
                                        category === key
                                            ? "bg-colorBgContainer font-medium ring-1 ring-inset ring-colorBorderSecondary"
                                            : "bg-transparent hover:bg-colorFillTertiary",
                                    )}
                                >
                                    <CategoryIcon
                                        aria-hidden
                                        size={14}
                                        className="shrink-0 text-colorTextSecondary"
                                    />
                                    <span className="truncate">{t(CATEGORY_LABELS[key])}</span>
                                </button>
                            )
                        })}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-2">
                        {ideas.length === 0 ? (
                            <p className="m-0 px-2 py-3 text-[13px] text-colorTextSecondary">
                                {t("builder.page.noIdeaMatches")}
                            </p>
                        ) : (
                            ideas.map((entry) => {
                                const IdeaIcon =
                                    IDEA_ICONS[entry.key] ?? CATEGORY_ICONS[entry.category]
                                return (
                                    <button
                                        key={entry.title}
                                        type="button"
                                        data-testid="builder-idea"
                                        onClick={() => onPick(entry.prompt)}
                                        className="flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent p-2.5 text-left hover:bg-colorFillTertiary"
                                    >
                                        <span className="box-border flex size-[26px] shrink-0 items-center justify-center rounded-[6px] border border-solid border-colorBorderSecondary bg-zinc-1 text-zinc-8">
                                            <IdeaIcon aria-hidden size={14} />
                                        </span>
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="text-[13px] font-medium leading-5 text-colorText">
                                                {entry.title}
                                            </span>
                                            <span className="line-clamp-2 text-[12px] leading-4 text-colorTextSecondary">
                                                {entry.prompt}
                                            </span>
                                        </span>
                                        {category === "all" ? (
                                            <span className="shrink-0 text-xs text-colorTextTertiary">
                                                {t(CATEGORY_LABELS[entry.category])}
                                            </span>
                                        ) : null}
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
