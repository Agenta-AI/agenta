import {useEffect, useRef, useState} from "react"

import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import {Button, CarouselDots, LoadingButton} from "@agenta/ui/ui"
import {motion, useInView} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {AppTileStack} from "./AppTileStack"
import {ExampleRun} from "./ExampleRun"
import {templateProviders} from "./marketplaceView"
import {SectionLabel} from "./SectionLabel"

/** Templates with an authored run, one at a time above the catalog; it advances on the dots' fill. */
export const FeaturedTemplate = ({
    templates,
    busy,
    paused = false,
    onUse,
    onPreview,
}: {
    templates: AgentStarterTemplate[]
    busy: boolean
    /** Something over the page, e.g. the preview drawer, holds the carousel. */
    paused?: boolean
    onUse: (template: AgentStarterTemplate) => void
    onPreview: (template: AgentStarterTemplate) => void
}) => {
    const presets = useMotionPresets()
    const ref = useRef<HTMLElement>(null)
    const inView = useInView(ref)
    const [index, setIndex] = useState(0)
    // Bumped on every slide change, so each visit replays its example run from the start.
    const [visit, setVisit] = useState(0)
    const [hovered, setHovered] = useState(false)
    const [focused, setFocused] = useState(false)
    const [pageHidden, setPageHidden] = useState(false)

    useEffect(() => {
        const sync = () => setPageHidden(document.hidden)
        sync()
        document.addEventListener("visibilitychange", sync)
        return () => document.removeEventListener("visibilitychange", sync)
    }, [])

    const current = Math.min(index, templates.length - 1)
    const holding = paused || hovered || focused || pageHidden || !inView
    const show = (slide: number) => {
        setIndex(slide)
        setVisit((value) => value + 1)
    }

    return (
        <section
            ref={ref}
            aria-label="Featured template"
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
            }}
            className="box-border hidden rounded-xl border border-solid border-border bg-colorFillQuaternary p-5 md:block lg:p-6"
        >
            {/* Every slide shares one cell and its rows, so a page change never moves anything. */}
            <div className="grid grid-cols-2 grid-rows-[repeat(5,auto)] gap-x-8 gap-y-3">
                {templates.map((template, slide) => {
                    const active = slide === current
                    return (
                        <motion.div
                            key={template.key}
                            aria-hidden={!active}
                            // motion.div drops the `inert` prop, so it is set on the node.
                            ref={(node) => {
                                node?.toggleAttribute("inert", !active)
                            }}
                            initial={false}
                            animate={{opacity: active ? 1 : 0, y: active ? 0 : 6}}
                            transition={presets.crossfadeTransition}
                            className={cn(
                                "col-span-full col-start-1 row-span-5 row-start-1 grid grid-cols-subgrid grid-rows-subgrid",
                                !active && "pointer-events-none",
                            )}
                        >
                            <SectionLabel className="col-start-1 row-start-1">
                                Featured · {template.category}
                            </SectionLabel>
                            <AppTileStack
                                apps={templateProviders(template)}
                                size="md"
                                className="col-start-1 row-start-2"
                            />
                            <h2 className="col-start-1 row-start-3 m-0 text-xl font-semibold text-foreground">
                                {template.name}
                            </h2>
                            <p className="text-muted-foreground col-start-1 row-start-4 m-0 max-w-[460px] text-sm leading-relaxed">
                                {template.overview || template.description}
                            </p>
                            <div className="col-start-1 row-start-5 mt-1 flex flex-wrap gap-2">
                                <LoadingButton loading={busy} onClick={() => onUse(template)}>
                                    Use this template
                                </LoadingButton>
                                <Button variant="outline" onClick={() => onPreview(template)}>
                                    Preview
                                </Button>
                            </div>
                            {template.example ? (
                                <ExampleRun
                                    key={active ? `${template.key}-${visit}` : template.key}
                                    example={template.example}
                                    active={active && !holding}
                                    loop={false}
                                    compact
                                    className="col-start-2 row-span-5 row-start-1 min-h-[190px]"
                                />
                            ) : null}
                        </motion.div>
                    )
                })}
            </div>
            {templates.length > 1 ? (
                <CarouselDots
                    className="mt-3 -ml-[3px]"
                    label="Featured templates"
                    count={templates.length}
                    index={current}
                    onSelect={show}
                    labels={templates.map((template) => template.name)}
                    progressMs={presets.featuredDwellMs}
                    progressPaused={holding}
                    onProgressEnd={() => show((current + 1) % templates.length)}
                />
            ) : null}
        </section>
    )
}
