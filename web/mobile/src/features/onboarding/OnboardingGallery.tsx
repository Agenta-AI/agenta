import {useEffect, useMemo, useRef} from "react"

import {templateCategories, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {Plus} from "@phosphor-icons/react"
import {motion} from "motion/react"

import {FOCUS_RING} from "@/lib/interactive"
import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {
    ALL,
    galleryTemplates,
    RECOMMENDED,
    type GalleryCategory,
    type OnboardingCatalog,
    type OnboardingRole,
} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {onboardingHeadingId} from "./onboardingDraft"
import {OnboardingTemplateDetail} from "./OnboardingTemplateDetail"
import {OnboardingTemplateTile} from "./OnboardingTemplateTile"
import {OnboardingGalleryError} from "./states/OnboardingGalleryError"
import {OnboardingGallerySkeleton} from "./states/OnboardingGallerySkeleton"

const copy = ONBOARDING_COPY.gallery

const ROW = cn(
    "flex w-full cursor-pointer items-center gap-3 rounded-lg border border-solid p-2.5 text-left text-foreground transition-colors",
    FOCUS_RING,
)

/** The real template catalog by category, one template in focus, and a blank start. */
export const OnboardingGallery = ({
    catalog,
    role,
    category,
    focus,
    onCategory,
    onFocus,
    onUse,
    onScratch,
}: {
    catalog: OnboardingCatalog
    role: OnboardingRole | null
    category: GalleryCategory
    focus: string | null
    onCategory: (category: GalleryCategory) => void
    onFocus: (key: string) => void
    onUse: (template: AgentStarterTemplate) => void
    onScratch: () => void
}) => {
    const chips = useMemo(
        () => [
            {id: RECOMMENDED, label: copy.recommended},
            ...templateCategories(catalog.templates).map((item) => ({id: item, label: item})),
            {id: ALL, label: copy.all},
        ],
        [catalog.templates],
    )
    const listed = useMemo(
        () => galleryTemplates(catalog.templates, category, role),
        [catalog.templates, category, role],
    )
    const focused = listed.find((item) => item.key === focus) ?? listed[0]
    const presets = useMotionPresets()
    // On a phone the chip row scrolls; keep the chosen category in view, also after a reload.
    const activeChipRef = useRef<HTMLButtonElement | null>(null)
    useEffect(() => {
        activeChipRef.current?.scrollIntoView?.({block: "nearest", inline: "nearest"})
    }, [category, catalog.status])

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
                <h1
                    id={onboardingHeadingId("gallery")}
                    tabIndex={-1}
                    className={ONBOARDING_COPY.headingClass}
                >
                    {copy.title}
                </h1>
                <p className="text-muted-foreground m-0 text-[15px]">{copy.subtitle}</p>
            </div>
            {catalog.status === "success" ? (
                <div
                    role="group"
                    aria-label={copy.categories}
                    className="-mx-4 flex scroll-px-4 gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0 [&::-webkit-scrollbar]:hidden"
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
                                    "h-8 shrink-0 cursor-pointer rounded-full border border-solid px-3.5 text-[13px] font-medium transition-colors",
                                    FOCUS_RING,
                                    active
                                        ? "border-foreground bg-foreground text-background"
                                        : "border-border bg-background text-foreground hover:bg-accent",
                                )}
                            >
                                {chip.label}
                            </button>
                        )
                    })}
                </div>
            ) : null}
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
                <div className="flex flex-col gap-1">
                    <button
                        type="button"
                        onClick={onScratch}
                        className={cn(ROW, "border-border hover:bg-accent mb-2 border-dashed")}
                    >
                        <span className="border-border flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-dashed">
                            <Plus size={16} />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-sm font-medium">{copy.scratch}</span>
                            <span className="text-muted-foreground block text-xs">
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
                                    className="flex flex-col gap-2"
                                >
                                    <button
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => onFocus(template.key)}
                                        onDoubleClick={() => onUse(template)}
                                        className={cn(
                                            ROW,
                                            active
                                                ? "bg-accent border-transparent"
                                                : "hover:bg-accent border-transparent bg-transparent",
                                        )}
                                    >
                                        <OnboardingTemplateTile template={template} />
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-medium">
                                                {template.name}
                                            </span>
                                            <span className="text-muted-foreground block truncate text-xs">
                                                {template.trigger}
                                            </span>
                                        </span>
                                    </button>
                                    {active ? (
                                        <motion.div
                                            variants={presets.fadeUp}
                                            initial="initial"
                                            animate="animate"
                                            className="mb-2 lg:hidden"
                                        >
                                            <OnboardingTemplateDetail
                                                template={template}
                                                onUse={onUse}
                                            />
                                        </motion.div>
                                    ) : null}
                                </motion.div>
                            )
                        })}
                        </div>
                    )}
                </div>
                {focused && catalog.status === "success" ? (
                    <motion.div
                        key={focused.key}
                        variants={presets.stepSlide}
                        custom={1}
                        initial="initial"
                        animate="animate"
                        className="sticky top-6 max-lg:hidden"
                    >
                        <OnboardingTemplateDetail template={focused} onUse={onUse} />
                    </motion.div>
                ) : null}
            </div>
        </div>
    )
}
