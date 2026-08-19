import {Children, useEffect, useRef, type ReactNode} from "react"

/** Capping the list is what keeps the actions below it on screen; 224px is 7 rows, 40vh wins on short viewports. */
const SCROLL_LIST_CLASS = "flex max-h-[min(40vh,224px)] flex-col overflow-y-auto"

interface SwitcherScrollListProps {
    /** Identifies the row marked `data-active`; a change re-runs the scroll. */
    activeKey?: string | null
    children: ReactNode
}

/** Scrollable body of a switcher panel: the project list, and the org list that replaces it. */
const SwitcherScrollList = ({activeKey, children}: SwitcherScrollListProps) => {
    const listRef = useRef<HTMLDivElement>(null)
    // A panel can open before its list lands, so the row count re-runs the scroll once it does.
    const rowCount = Children.count(children)

    // The dropdown's `destroyOnHidden` remounts the panel, so this also covers every reopen.
    useEffect(() => {
        listRef.current?.querySelector("[data-active=true]")?.scrollIntoView({block: "nearest"})
    }, [activeKey, rowCount])

    return (
        <div ref={listRef} className={SCROLL_LIST_CLASS}>
            {children}
        </div>
    )
}

export default SwitcherScrollList
