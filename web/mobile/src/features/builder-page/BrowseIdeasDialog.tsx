import {useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {Dialog, DialogContent, DialogTitle, SearchInput} from "@agenta/ui/ui"
import {
    ChartBar,
    ChatText,
    GitBranch,
    Lightning,
    List,
    Sparkle,
    SlidersHorizontal,
    Users,
    Wrench,
    type Icon,
} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {CATEGORY_LABELS, filterIdeas, IDEA_CATEGORIES, IDEAS, type IdeaCategory} from "./ideas"

const CATEGORY_ICONS: Record<IdeaCategory | "all", Icon> = {
    all: List,
    gettingStarted: Sparkle,
    support: ChatText,
    sales: Users,
    operations: GitBranch,
    engineering: Wrench,
    improve: SlidersHorizontal,
    test: ChartBar,
    automations: Lightning,
}

/**
 * "Browse ideas" (B02): a search field, the categories and the ready prompts. A pick puts the
 * prompt in the composer and closes the dialog; nothing is sent.
 */
export const BrowseIdeasDialog = ({
    open,
    onOpenChange,
    onPick,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onPick: (prompt: string) => void
}) => {
    const t = useT(builderPageCatalog)
    const [category, setCategory] = useState<IdeaCategory | "all">("all")
    const [search, setSearch] = useState("")
    const ideas = useMemo(
        () =>
            filterIdeas(
                IDEAS.map((entry) => ({
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
                className="flex h-[min(560px,85dvh)] max-w-[760px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]"
            >
                <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary py-3 pl-4 pr-12">
                    <DialogTitle className="m-0 flex-1 text-sm font-semibold">
                        {t("builder.page.browseIdeas")}
                    </DialogTitle>
                    <SearchInput
                        aria-label={t("builder.page.searchIdeas")}
                        placeholder={t("builder.page.searchIdeas")}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        className="w-60 max-sm:w-40"
                    />
                </div>
                <div className="flex min-h-0 flex-1">
                    <div
                        role="tablist"
                        aria-orientation="vertical"
                        className="flex w-52 shrink-0 flex-col gap-px overflow-y-auto border-0 border-r border-solid border-colorBorderSecondary p-2 max-sm:w-36"
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
                                        "flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md border-0 px-2 text-left text-[13px] text-colorText",
                                        category === key
                                            ? "bg-colorFillSecondary font-medium"
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
                    <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
                        {ideas.length === 0 ? (
                            <p className="m-0 px-2 py-3 text-[13px] text-colorTextSecondary">
                                {t("builder.page.noIdeaMatches")}
                            </p>
                        ) : (
                            ideas.map((entry) => {
                                const IdeaIcon = CATEGORY_ICONS[entry.category]
                                return (
                                    <button
                                        key={entry.title}
                                        type="button"
                                        data-testid="builder-idea"
                                        onClick={() => onPick(entry.prompt)}
                                        className="flex w-full cursor-pointer items-start gap-3 rounded-lg border-0 bg-transparent p-2.5 text-left hover:bg-colorFillTertiary"
                                    >
                                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-colorFillTertiary text-colorTextSecondary">
                                            <IdeaIcon aria-hidden size={14} />
                                        </span>
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="text-[13px] font-medium text-colorText">
                                                {entry.title}
                                            </span>
                                            <span className="line-clamp-2 text-xs text-colorTextSecondary">
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
