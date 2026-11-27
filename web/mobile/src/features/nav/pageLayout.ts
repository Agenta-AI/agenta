import {atomWithStorage} from "jotai/utils"

/** The user's sidebar pages: the visible ones in order, and the ones in "More". */
export interface PageLayout {
    visible: string[]
    hidden: string[]
}

/** Null until the user arranges something; Reset writes null back. */
export const pageLayoutAtom = atomWithStorage<PageLayout | null>(
    "agenta:sidebar:pages:v1",
    null,
    undefined,
    {getOnInit: true},
)

/** Applies a saved layout to today's pages; a page it has never seen lands where the default puts it. */
export const arrangePages = (
    keys: readonly string[],
    defaultHidden: ReadonlySet<string>,
    saved: PageLayout | null,
): PageLayout => {
    if (!saved) {
        return {
            visible: keys.filter((key) => !defaultHidden.has(key)),
            hidden: keys.filter((key) => defaultHidden.has(key)),
        }
    }
    const visible = saved.visible.filter((key) => keys.includes(key))
    const hidden = saved.hidden.filter((key) => keys.includes(key) && !visible.includes(key))
    keys.forEach((key, index) => {
        if (visible.includes(key) || hidden.includes(key)) return
        if (defaultHidden.has(key)) {
            hidden.push(key)
            return
        }
        const before = keys
            .slice(0, index)
            .reverse()
            .find((earlier) => visible.includes(earlier))
        visible.splice(before ? visible.indexOf(before) + 1 : 0, 0, key)
    })
    return {visible, hidden}
}
