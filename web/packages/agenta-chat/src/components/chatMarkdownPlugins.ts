import {useEffect, useState} from "react"

/**
 * Which optional plugins this markdown needs. A false positive only loads a chunk early, so plain
 * substring checks are enough, and a fence or `$$` that has just streamed in counts. Math is `$$`
 * only because `@streamdown/math` keeps `singleDollarTextMath` off.
 */
export const detectMarkdownPlugins = (content: string) => ({
    math: content.includes("$$"),
    code: content.includes("```") || content.includes("~~~"),
})

export interface LazyMarkdownPlugin<T> {
    current: () => T | undefined
    load: () => Promise<T | undefined>
}

/** One download per page, shared by every message. A failed load stays plain and may retry. */
export const lazyMarkdownPlugin = <T>(importPlugin: () => Promise<T>): LazyMarkdownPlugin<T> => {
    let value: T | undefined
    let pending: Promise<T | undefined> | undefined
    return {
        current: () => value,
        load: () =>
            (pending ??= importPlugin().then(
                (plugin) => (value = plugin),
                () => {
                    pending = undefined
                    return undefined
                },
            )),
    }
}

/** The plugin once it is loaded; `needed` starts the load, and until it lands the render is plain. */
export const useLazyMarkdownPlugin = <T>(plugin: LazyMarkdownPlugin<T>, needed: boolean) => {
    const [value, setValue] = useState(plugin.current)
    useEffect(() => {
        if (!needed) return
        let live = true
        void plugin.load().then((loaded) => {
            if (live) setValue(() => loaded)
        })
        return () => {
            live = false
        }
    }, [plugin, needed])
    return value
}
