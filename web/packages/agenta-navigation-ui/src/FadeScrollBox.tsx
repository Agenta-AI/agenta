import {useEffect, useRef, type ReactNode, type UIEvent} from "react"

import clsx from "clsx"

/** Scroll box with no scrollbar that fades its content at an edge with more to scroll. */
export const FadeScrollBox = ({
    children,
    className,
    boxClassName,
    revealSelector,
    onScroll,
    ...boxAttrs
}: {
    children: ReactNode
    /** Classes for the content column inside the scroll box. */
    className?: string
    /** Classes for the scroll box itself. */
    boxClassName?: string
    /** On mount, scroll the first match into view once it renders, unless the user scrolled first. */
    revealSelector?: string
    onScroll?: (event: UIEvent<HTMLDivElement>) => void
} & Record<`data-${string}`, string>) => {
    const boxRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const revealed = useRef(!revealSelector)

    // Rows load in pages, so this retries on every content resize until the target shows up.
    const reveal = () => {
        const box = boxRef.current
        if (revealed.current || !box || !revealSelector) return
        const target = box.querySelector<HTMLElement>(revealSelector)
        if (!target) return
        revealed.current = true
        const inset = box.querySelector<HTMLElement>("[data-sticky-heading]")?.offsetHeight ?? 0
        const boxRect = box.getBoundingClientRect()
        const rect = target.getBoundingClientRect()
        if (rect.top >= boxRect.top + inset && rect.bottom <= boxRect.bottom) return
        box.scrollTop += rect.top - boxRect.top - (box.clientHeight - rect.height) / 2
    }

    // Written to the DOM, not state, so a scroll frame never re-renders the rows.
    const sync = () => {
        const box = boxRef.current
        if (!box) return
        const {scrollTop, scrollHeight, clientHeight} = box
        // 1px slack: fractional zoom stops scrollTop just short of the end.
        box.dataset.fadeTop = String(scrollTop > 1)
        box.dataset.fadeBottom = String(scrollHeight - clientHeight - scrollTop > 1)
        // The top fade starts under a stuck heading, not over it.
        const heading = box.querySelector<HTMLElement>("[data-sticky-heading]")
        box.style.setProperty("--ag-fade-inset", `${heading?.offsetHeight ?? 0}px`)
    }

    // Pages load and headings collapse without a scroll event.
    useEffect(() => {
        const box = boxRef.current
        const content = contentRef.current
        if (!box || !content) return
        reveal()
        sync()
        const observer = new ResizeObserver(() => {
            reveal()
            sync()
        })
        observer.observe(box)
        observer.observe(content)
        // The selection can land after the rows render, which changes no size.
        const mutations = revealSelector ? new MutationObserver(() => reveal()) : null
        mutations?.observe(content, {
            subtree: true,
            childList: true,
            attributeFilter: ["data-selected"],
        })
        return () => {
            observer.disconnect()
            mutations?.disconnect()
        }
    }, [])

    return (
        <div
            {...boxAttrs}
            ref={boxRef}
            className={clsx(
                "ag-scroll-fade ag-scroll-no-bar min-h-0 overflow-y-auto",
                boxClassName,
            )}
            onScroll={(event) => {
                // A scroll before the target renders is the user's; do not yank the list after it.
                revealed.current = true
                sync()
                onScroll?.(event)
            }}
        >
            <div ref={contentRef} className={className}>
                {children}
            </div>
        </div>
    )
}
