import {useLayoutEffect, useRef, useState} from "react"

import clsx from "clsx"

import {type AgentTemplate} from "@/oss/components/pages/agent-home/assets/templates"

import TemplateChip from "./TemplateChip"

interface TemplateChipDockProps {
    template: AgentTemplate
    /** Whether a template is currently selected — drives the fade/rise in and out. */
    visible: boolean
    onClear: () => void
}

const noop = () => {}

/**
 * Docks the provenance chip above the composer and animates it. Two transitions run together:
 * fade + rise on select/clear, and a WIDTH morph when switching templates.
 *
 * The chip is `w-fit`, so auto width can't be transitioned directly. We render an off-flow ghost
 * at natural (max-content) width, measure it, and drive an explicit width on the VISIBLE chip —
 * the chip itself animates + clips its own content, so the border/background move with the width
 * in both directions (measuring a transparent wrapper only revealed content on grow, not shrink).
 */
const TemplateChipDock = ({template, visible, onClear}: TemplateChipDockProps) => {
    const ghostRef = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState<number>()

    // Mirror the ghost's natural width onto the visible chip. A ResizeObserver catches both the
    // template swap and late size changes (e.g. badge images decoding).
    useLayoutEffect(() => {
        const el = ghostRef.current
        if (!el) return
        const measure = () => setWidth(el.offsetWidth)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    return (
        <div className="relative">
            {/* Off-flow, unpainted copy at natural width — the measurement source only. */}
            <div
                ref={ghostRef}
                aria-hidden
                inert
                className="pointer-events-none invisible absolute left-0 top-0 w-max"
            >
                <TemplateChip template={template} onClear={noop} />
            </div>
            <div
                className={clsx(
                    "origin-bottom-left transition-[opacity,transform] duration-200 ease-out",
                    visible
                        ? "translate-y-0 opacity-100"
                        : "pointer-events-none translate-y-1 opacity-0",
                )}
                inert={!visible}
            >
                <TemplateChip
                    template={template}
                    onClear={onClear}
                    style={{width}}
                    // Children keep their natural size and clip (not squish) while the width eases.
                    className="overflow-hidden transition-[width] duration-200 ease-out [&>*]:shrink-0"
                />
            </div>
        </div>
    )
}

export default TemplateChipDock
