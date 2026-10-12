import {useEffect, useState, type RefObject} from "react"

/** The nearest scrolling ancestor, or null for the viewport. */
export const findScrollRoot = (element: Element | null): Element | null => {
    for (let node = element?.parentElement; node; node = node.parentElement) {
        const {overflowY} = getComputedStyle(node)
        if (overflowY === "auto" || overflowY === "scroll") return node
    }
    return null
}

/** An observer's `root`: margins only buffer against the element that actually clips. */
export const useScrollRoot = (ref: RefObject<Element | null>) => {
    const [root, setRoot] = useState<Element | null>(null)
    useEffect(() => setRoot(findScrollRoot(ref.current)), [ref])
    return root
}
