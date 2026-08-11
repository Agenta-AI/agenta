import {X} from "lucide-react"
import {AnimatePresence, LayoutGroup, motion} from "motion/react"

import {
    templateProviderSlugs,
    type AgentTemplate,
} from "@/oss/components/pages/agent-home/assets/templates"

import {STRIP_COPY} from "../assets/constants"

import IntegrationBadges from "./IntegrationBadges"

// bounce 0 keeps the 1.5px border from overshooting its target width during the morph.
const WIDTH_SPRING = {type: "spring", visualDuration: 0.32, bounce: 0} as const
const CONTENT_TRANSITION = {duration: 0.26, ease: "linear"} as const

/** Provenance chip docked flush on the composer's top edge (no bottom border); morphs its width and crossfades its content on a template switch. */
const TemplateChip = ({
    template,
    onClear,
    className,
}: {
    template: AgentTemplate
    onClear: () => void
    className?: string
}) => (
    <LayoutGroup>
        <motion.div
            layout
            transition={{layout: WIDTH_SPRING}}
            // Inline radius so Motion scale-corrects it during the morph (Tailwind radius isn't corrected).
            style={{borderRadius: "9px 9px 0 0"}}
            className={`relative box-border inline-flex w-fit items-center gap-2 overflow-hidden whitespace-nowrap border-[1.5px] border-b-0 border-solid border-[var(--ag-colorPrimary)] bg-[var(--ag-colorBgContainer)] bg-[image:linear-gradient(var(--ag-strip-selected-bg),var(--ag-strip-selected-bg))] px-3 py-1.5 text-[12.5px] text-[var(--ag-colorTextSecondary)] ${className ?? ""}`}
        >
            <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                    key={template.key}
                    layout="position"
                    initial={{opacity: 0}}
                    animate={{opacity: 1}}
                    exit={{opacity: 0}}
                    transition={CONTENT_TRANSITION}
                    className="inline-flex shrink-0 items-center gap-2"
                >
                    <span
                        className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[9px] font-semibold text-white"
                        style={{background: template.color}}
                    >
                        {template.initials}
                    </span>
                    <span>
                        {STRIP_COPY.fromTemplate}{" "}
                        <b className="font-semibold text-[var(--ag-colorText)]">{template.name}</b>
                    </span>
                    <IntegrationBadges slugs={templateProviderSlugs(template)} size="chip" />
                </motion.div>
            </AnimatePresence>
            <button
                type="button"
                aria-label="Remove template"
                onClick={onClear}
                className="relative z-[1] shrink-0 cursor-pointer border-0 bg-transparent px-0.5 py-0 text-[var(--ag-colorTextTertiary)] hover:text-[var(--ag-colorTextSecondary)]"
            >
                <X size={12} />
            </button>
        </motion.div>
    </LayoutGroup>
)

export default TemplateChip
