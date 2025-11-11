import {useSetAtom} from "jotai"
import {useEffect} from "react"

import {
    appendBreadcrumbAtom,
    clearBreadcrumbsAtom,
    prependBreadcrumbAtom,
    setBreadcrumbsAtom,
    type BreadcrumbAtom,
} from "@/oss/lib/atoms/breadcrumb"

export const useBreadcrumbs = () => {
    const setBreadcrumbs = useSetAtom(setBreadcrumbsAtom)
    const appendBreadcrumb = useSetAtom(appendBreadcrumbAtom)
    const prependBreadcrumb = useSetAtom(prependBreadcrumbAtom)
    const clearBreadcrumbs = useSetAtom(clearBreadcrumbsAtom)

    return {
        setBreadcrumbs,
        appendBreadcrumb,
        prependBreadcrumb,
        clearBreadcrumbs,
    }
}

/**
 * Hook to manage breadcrumbs with automatic cleanup on unmount
 * 
 * @param {BreadcrumbAtom} breadcrumbs - Object containing breadcrumb items to set
 * @param {'prepend' | 'append' | 'new'} [type='new'] - How to apply the breadcrumbs:
 *   - 'prepend': Add breadcrumbs before existing ones
 *   - 'append': Add breadcrumbs after existing ones
 *   - 'new': Replace all existing breadcrumbs (default)
 * @param {boolean} [condition=true] - Whether to apply the breadcrumbs
 * @param {React.DependencyList} deps - Dependencies array to re-run the effect when changed
 */
export const useBreadcrumbsEffect = (
    {
        breadcrumbs = {},
        type = "new",
        condition = true,
    }: {breadcrumbs: BreadcrumbAtom; type?: "prepend" | "append" | "new"; condition?: boolean},
    deps: React.DependencyList = [],
) => {
    const {setBreadcrumbs, clearBreadcrumbs, appendBreadcrumb, prependBreadcrumb} = useBreadcrumbs()

    useEffect(() => {
        if (condition) {
            if (type === "prepend") {
                prependBreadcrumb(breadcrumbs)
            } else if (type === "append") {
                appendBreadcrumb(breadcrumbs)
            } else {
                setBreadcrumbs(breadcrumbs)
            }
        }

        // Cleanup: reset to URL-based breadcrumbs when component unmounts
        return () => {
            if (type === "new") {
                clearBreadcrumbs()
            }
        }
    }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}
