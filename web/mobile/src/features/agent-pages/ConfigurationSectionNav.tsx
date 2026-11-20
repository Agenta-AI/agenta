import {useEffect, useRef, useState, type RefObject} from "react"

import {cn} from "@/lib/utils"

interface SectionAnchor {
    key: string
    title: string
}

/**
 * The space above a section when it is scrolled to: the Agent tab's top padding and the list's
 * sticky offset (`pt-7` and `top-7` in ConfigurationAgentTab).
 */
const SECTION_TOP = 28

/** The titled section anchors the configuration renders, in document order. */
const readAnchors = (root: HTMLElement): (SectionAnchor & {el: HTMLElement})[] =>
    [...root.querySelectorAll<HTMLElement>("[data-config-section]")].flatMap((el) => {
        const key = el.dataset.configSection
        const title = el.dataset.configSectionTitle
        return key && title ? [{key, title, el}] : []
    })

/**
 * The list of the configuration's sections beside it. A click scrolls to that section; the
 * section in view is marked. The list follows the sections the configuration renders, so it
 * never names a section the agent's template does not have.
 */
export const ConfigurationSectionNav = ({
    contentRef,
}: {
    /** The scrolling element that holds the configuration. */
    contentRef: RefObject<HTMLElement | null>
}) => {
    const [sections, setSections] = useState<SectionAnchor[]>([])
    const [current, setCurrent] = useState<string | null>(null)
    // A clicked section stays marked through its own scroll, which may stop short of it (the
    // last sections cannot reach the top); the reader's own scroll clears it.
    const clicked = useRef<string | null>(null)

    // The sections arrive with the configuration and can change with it.
    useEffect(() => {
        const root = contentRef.current
        if (!root) return
        const update = () =>
            setSections((before) => {
                const next = readAnchors(root).map(({key, title}) => ({key, title}))
                const same =
                    before.length === next.length &&
                    before.every((s, i) => s.key === next[i].key && s.title === next[i].title)
                return same ? before : next
            })
        update()
        const observer = new MutationObserver(update)
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributeFilter: ["data-config-section", "data-config-section-title"],
        })
        return () => observer.disconnect()
    }, [contentRef])

    // The marked section is the last one whose top has passed the top of the scroll box.
    useEffect(() => {
        const root = contentRef.current
        if (!root || sections.length === 0) return
        const mark = () => {
            if (clicked.current) {
                setCurrent(clicked.current)
                return
            }
            // Scrolled to the bottom, the last section is the one in view, though its top never
            // reaches. At the top of the page the first section is, however short the page.
            if (root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 1) {
                setCurrent(sections[sections.length - 1].key)
                return
            }
            const top = root.getBoundingClientRect().top + SECTION_TOP + 8
            let inView = sections[0].key
            for (const {key, el} of readAnchors(root)) {
                if (el.getBoundingClientRect().top <= top) inView = key
            }
            setCurrent(inView)
        }
        const release = () => {
            clicked.current = null
        }
        mark()
        root.addEventListener("scroll", mark, {passive: true})
        root.addEventListener("wheel", release, {passive: true})
        root.addEventListener("touchmove", release, {passive: true})
        root.addEventListener("keydown", release)
        return () => {
            root.removeEventListener("scroll", mark)
            root.removeEventListener("wheel", release)
            root.removeEventListener("touchmove", release)
            root.removeEventListener("keydown", release)
        }
    }, [contentRef, sections])

    if (sections.length === 0) return null
    return (
        <nav className="flex flex-col gap-0.5" data-testid="configuration-section-nav">
            {sections.map((section) => (
                <button
                    key={section.key}
                    type="button"
                    aria-current={current === section.key ? "location" : undefined}
                    className={cn(
                        "h-8 truncate rounded-[8px] border-0 bg-transparent px-2.5 text-left text-[13px] [font-family:inherit]",
                        current === section.key
                            ? "bg-[var(--ag-controlItemBgActive)] font-medium text-colorText"
                            : "cursor-pointer text-colorTextSecondary hover:text-colorText",
                    )}
                    onClick={() => {
                        const root = contentRef.current
                        const el = root && readAnchors(root).find((a) => a.key === section.key)?.el
                        if (!root || !el) return
                        root.scrollTo({
                            top:
                                el.getBoundingClientRect().top -
                                root.getBoundingClientRect().top +
                                root.scrollTop -
                                SECTION_TOP,
                            behavior: "smooth",
                        })
                        clicked.current = section.key
                        setCurrent(section.key)
                    }}
                >
                    {section.title}
                </button>
            ))}
        </nav>
    )
}
