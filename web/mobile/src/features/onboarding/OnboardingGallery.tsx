import {useEffect, useMemo, useRef, type ReactNode} from "react"

import {templateCategories, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {Button} from "@agenta/ui/ui"
import {ArrowLeft, Plus} from "@phosphor-icons/react"
import {motion} from "motion/react"

import {
    ALL,
    categoryLabel,
    galleryTemplates,
    RECOMMENDED,
    type GalleryCategory,
    type OnboardingCatalog,
} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import type {OnboardingCreateState} from "./OnboardingCreateState"
import type {OnboardingAgent} from "./onboardingDraft"
import {onboardingHeadingId, type GalleryFocus} from "./onboardingRoute"
import {OnboardingScratchPanel} from "./OnboardingScratchPanel"
import {OnboardingTemplateDetail} from "./OnboardingTemplateDetail"
import {OnboardingTemplateTile} from "./OnboardingTemplateTile"
import {OnboardingGalleryError} from "./states/OnboardingGalleryError"
import {OnboardingGallerySkeleton} from "./states/OnboardingGallerySkeleton"
import {useGalleryDetail} from "./useGalleryDetail"

import {FOCUS_RING} from "@/lib/interactive"
import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

const copy = ONBOARDING_COPY.gallery

const ROW =
    "flex h-14 w-full shrink-0 cursor-pointer items-center gap-3 rounded-[10px] px-3 text-left text-foreground transition-colors"

/** The template catalog by category, one template or the blank start in focus beside it. */
export const OnboardingGallery = ({
    catalog,
    preferred,
    category,
    focus,
    agent,
    create,
    onCategory,
    onFocus,
    onCloseDetail,
    onUse,
    onChange,
}: {
    catalog: OnboardingCatalog
    /** The catalog category the answers put first under Recommended. */
    preferred: string | undefined
    category: GalleryCategory
    /** From the URL: `/templates/<key>` or `/templates/scratch`. */
    focus: GalleryFocus
    /** The blank start's agent, edited in the scratch panel. */
    agent: OnboardingAgent
    create: OnboardingCreateState
    onCategory: (category: GalleryCategory) => void
    /** `open`: a phone shows the panel on its own view, a new history entry. */
    onFocus: (focus: GalleryFocus, open: boolean) => void
    onCloseDetail: () => void
    onUse: (template: AgentStarterTemplate) => void
    onChange: (patch: Partial<Omit<OnboardingAgent, "apps">>) => void
}) => {
    const presets = useMotionPresets()
    const chips = useMemo(
        () => [
            {id: RECOMMENDED, label: copy.recommended},
            ...templateCategories(catalog.templates).map((item) => ({
                id: item,
                label: categoryLabel(item),
            })),
            {id: ALL, label: copy.all},
        ],
        [catalog.templates],
    )
    const listed = useMemo(
        () => galleryTemplates(catalog.templates, category, preferred),
        [catalog.templates, category, preferred],
    )
    const scratch = focus?.kind === "scratch"
    const focusKey = focus?.kind === "template" ? focus.key : null
    const focused = scratch
        ? null
        : (listed.find((item) => item.key === focusKey) ??
          catalog.templates.find((item) => item.key === focusKey) ??
          listed[0] ??
          null)

    // On a phone the chip row scrolls; keep the chosen category in view, also after a reload.
    const activeChipRef = useRef<HTMLButtonElement | null>(null)
    useEffect(() => {
        activeChipRef.current?.scrollIntoView?.({block: "nearest", inline: "nearest"})
    }, [category, catalog.status])

    const panelKey = scratch ? "scratch" : (focused?.key ?? "none")
    const rootRef = useRef<HTMLDivElement | null>(null)
    const detail = useGalleryDetail(rootRef, focus !== null)
    const focusAndOpen = (next: GalleryFocus) => {
        if (!detail.twoColumn) detail.rememberListScroll()
        onFocus(next, !detail.twoColumn)
    }
    const shownPanel: ReactNode = scratch ? (
        <OnboardingScratchPanel agent={agent} onChange={onChange} create={create} />
    ) : focused ? (
        <OnboardingTemplateDetail template={focused} onUse={onUse} />
    ) : null

    return (
        <div ref={rootRef} className="min-w-0">
            {detail.open && shownPanel ? (
                <motion.div
                    key={`detail-${panelKey}`}
                    variants={presets.stepSlide}
                    custom={1}
                    initial="initial"
                    animate="animate"
                    className="flex min-w-0 flex-col gap-3 md:hidden"
                >
                    <Button
                        variant="ghost"
                        onClick={onCloseDetail}
                        className="-ml-3 h-11 self-start px-3 text-sm font-medium"
                    >
                        <ArrowLeft data-icon="inline-start" />
                        {copy.backToTemplates}
                    </Button>
                    {shownPanel}
                </motion.div>
            ) : null}
            <motion.div
                key={detail.open ? "list-under-detail" : "list"}
                variants={presets.stepSlide}
                custom={-1}
                initial={detail.returning ? "initial" : false}
                animate="animate"
                className={cn("flex min-w-0 flex-col gap-6", detail.open && "max-md:hidden")}
            >
                <div className="flex flex-col gap-1.5">
                    <h1
                        id={onboardingHeadingId("templates")}
                        tabIndex={-1}
                        className={ONBOARDING_COPY.headingClass}
                    >
                        {copy.title}
                    </h1>
                    <p className="text-muted-foreground m-0 text-[15px] leading-[22px]">
                        {copy.subtitle}
                    </p>
                </div>
                {catalog.status === "success" ? (
                    <div
                        role="group"
                        aria-label={copy.categories}
                        className="-mx-4 flex scroll-px-4 gap-1.5 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
                    >
                        {chips.map((chip) => {
                            const active = chip.id === category
                            return (
                                <button
                                    type="button"
                                    key={chip.id}
                                    ref={active ? activeChipRef : undefined}
                                    aria-pressed={active}
                                    onClick={() => onCategory(chip.id)}
                                    className={cn(
                                        "h-7 shrink-0 cursor-pointer rounded-md border-0 px-2.5 text-xs font-medium leading-4 transition-colors",
                                        FOCUS_RING,
                                        active
                                            ? "bg-foreground text-background"
                                            : "bg-background text-foreground ring-foreground/10 shadow-xs ring-1",
                                    )}
                                >
                                    {chip.label}
                                </button>
                            )
                        })}
                    </div>
                ) : null}
                <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 md:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
                    <div className="flex min-w-0 flex-col gap-1 md:-mx-0.5 md:-my-3 md:max-h-[calc(100dvh-340px)] md:min-h-60 md:overflow-y-auto md:px-0.5 md:py-3 md:[mask-image:linear-gradient(180deg,transparent_0,#000_16px,#000_calc(100%-24px),transparent_100%)] md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden">
                        <button
                            type="button"
                            aria-pressed={scratch}
                            onClick={() => focusAndOpen({kind: "scratch"})}
                            className={cn(
                                ROW,
                                "mb-1.5 border-[1.5px] border-dashed",
                                FOCUS_RING,
                                scratch
                                    ? "border-muted-foreground bg-muted"
                                    : "border-border hover:border-muted-foreground hover:bg-background bg-transparent",
                            )}
                        >
                            <span className="bg-background ring-border flex size-[34px] shrink-0 items-center justify-center rounded-[9px] ring-1">
                                <Plus size={16} />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="text-sm font-medium leading-5">
                                    {copy.scratch}
                                </span>
                                <span className="text-muted-foreground text-xs leading-[18px]">
                                    {copy.scratchHint}
                                </span>
                            </span>
                        </button>
                        {catalog.status === "pending" ? (
                            <OnboardingGallerySkeleton />
                        ) : catalog.status === "error" ? (
                            <OnboardingGalleryError onRetry={catalog.retry} />
                        ) : listed.length === 0 ? (
                            <p className="text-muted-foreground m-0 py-4 text-sm">{copy.empty}</p>
                        ) : (
                            // Keyed by category, so a chip switch replays the rows' stagger.
                            <div key={category} className="flex flex-col gap-1">
                                {listed.map((template, index) => {
                                    const active = template.key === focused?.key
                                    return (
                                        <motion.div
                                            key={template.key}
                                            variants={presets.fadeUp}
                                            custom={index * 0.04}
                                            initial="initial"
                                            animate="animate"
                                            className="flex flex-col"
                                        >
                                            <button
                                                type="button"
                                                aria-pressed={active}
                                                onClick={() =>
                                                    focusAndOpen({
                                                        kind: "template",
                                                        key: template.key,
                                                    })
                                                }
                                                onDoubleClick={() => onUse(template)}
                                                className={cn(
                                                    ROW,
                                                    "border-0",
                                                    FOCUS_RING,
                                                    active
                                                        ? "bg-muted"
                                                        : "hover:bg-muted bg-transparent",
                                                )}
                                            >
                                                <OnboardingTemplateTile template={template} />
                                                <span className="flex min-w-0 flex-1 flex-col">
                                                    <span className="text-sm font-medium leading-5">
                                                        {template.name}
                                                    </span>
                                                    <span className="text-muted-foreground truncate text-xs leading-[18px]">
                                                        {template.trigger}
                                                    </span>
                                                </span>
                                            </button>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                    {shownPanel ? (
                        <motion.div
                            key={panelKey}
                            variants={presets.stepSlide}
                            custom={1}
                            initial="initial"
                            animate="animate"
                            className="sticky top-24 max-md:hidden"
                        >
                            {shownPanel}
                        </motion.div>
                    ) : null}
                </div>
            </motion.div>
        </div>
    )
}
