import {useEffect, useState, type RefObject} from "react"

import {cn} from "@agenta/ui/styles"

interface SectionAnchor {
    key: string
    title: string
}

/** The sections the configuration renders, in order, read from their anchors. */
const readAnchors = (root: HTMLElement): SectionAnchor[] =>
    [...root.querySelectorAll<HTMLElement>("[data-config-section]")].flatMap((el) => {
        const key = el.dataset.configSection
        const title = el.dataset.configSectionTitle
        return key && title ? [{key, title}] : []
    })

const anchorOf = (root: HTMLElement, key: string) =>
    [...root.querySelectorAll<HTMLElement>("[data-config-section]")].find(
        (el) => el.dataset.configSection === key,
    ) ?? null

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

    // The sections arrive with the configuration and can change with it.
    useEffect(() => {
        const root = contentRef.current
        if (!root) return
        const update = () =>
            setSections((before) => {
                const next = readAnchors(root)
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
            const top = root.getBoundingClientRect().top + 8
            let inView = sections[0].key
            // One scan per scroll: the anchors in document order.
            for (const el of root.querySelectorAll<HTMLElement>("[data-config-section]")) {
                const key = el.dataset.configSection
                if (key && el.dataset.configSectionTitle && el.getBoundingClientRect().top <= top)
                    inView = key
            }
            setCurrent(inView)
        }
        mark()
        root.addEventListener("scroll", mark, {passive: true})
        return () => root.removeEventListener("scroll", mark)
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
                        "h-8 truncate rounded-md border-0 bg-transparent px-2.5 text-left text-sm [font-family:inherit]",
                        current === section.key
                            ? "bg-colorFillSecondary font-medium text-colorText"
                            : "cursor-pointer text-colorTextSecondary hover:text-colorText",
                    )}
                    onClick={() => {
                        const root = contentRef.current
                        const el = root && anchorOf(root, section.key)
                        if (!root || !el) return
                        root.scrollTo({
                            top:
                                el.getBoundingClientRect().top -
                                root.getBoundingClientRect().top +
                                root.scrollTop,
                            behavior: "smooth",
                        })
                        setCurrent(section.key)
                    }}
                >
                    {section.title}
                </button>
            ))}
        </nav>
    )
}
