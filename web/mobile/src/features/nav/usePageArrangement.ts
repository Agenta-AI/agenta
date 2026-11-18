import {useMemo} from "react"

import type {SidebarArrange, SidebarConfig} from "@agenta/navigation"
import {message} from "@agenta/ui/app-message"
import {useAtom} from "jotai"

import {arrangePages, pageLayoutAtom, type PageLayout} from "./pageLayout"

const TOAST_KEY = "sidebar-arrange"

const describe = (before: PageLayout, after: PageLayout, titleOf: (key: string) => string) => {
    const hid = after.hidden.find((key) => !before.hidden.includes(key))
    if (hid) return `${titleOf(hid)} moved to More.`
    const shown = before.hidden.find((key) => !after.hidden.includes(key))
    if (shown) return `${titleOf(shown)} is back in the sidebar.`
    return "Sidebar order updated."
}

/** The pages in the user's order, and the drag handlers that change it. Every change offers Undo. */
export const usePageArrangement = (
    pages: SidebarConfig[],
    defaultHidden: ReadonlySet<string>,
): {visible: SidebarConfig[]; arrange: SidebarArrange} => {
    const [saved, setSaved] = useAtom(pageLayoutAtom)

    return useMemo(() => {
        const byKey = new Map(pages.map((page) => [page.key, page]))
        const layout = arrangePages([...byKey.keys()], defaultHidden, saved)
        const titleOf = (key: string) => String(byKey.get(key)?.title ?? "Page")
        const pick = (keys: string[]) => keys.flatMap((key) => byKey.get(key) ?? [])

        // Pages absent today (Developer Mode off) keep their saved place for when they return.
        const absent = (keys: string[] = []) => keys.filter((key) => !byKey.has(key))
        const change = (next: PageLayout | null, text: string) => {
            setSaved(next)
            message.open({
                key: TOAST_KEY,
                type: "success",
                content: text,
                duration: 5,
                action: {label: "Undo", onClick: () => setSaved(saved)},
            })
        }

        return {
            visible: pick(layout.visible),
            arrange: {
                hidden: pick(layout.hidden),
                onArrange: (visible, hidden) =>
                    change(
                        {
                            visible: [...visible, ...absent(saved?.visible)],
                            hidden: [...hidden, ...absent(saved?.hidden)],
                        },
                        describe(layout, {visible, hidden}, titleOf),
                    ),
                onReset: () => change(null, "Sidebar reset to default."),
            },
        }
    }, [defaultHidden, pages, saved, setSaved])
}
