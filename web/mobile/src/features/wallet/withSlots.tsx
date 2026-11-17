import {Fragment, type ReactNode} from "react"

const MARK = "\u0001"

/**
 * Puts nodes into a translated sentence that keeps them as placeholders, so a sentence with an
 * animated number stays one key: `withSlots((values) => t("key", values), {usd: <Figure />})`.
 */
export const withSlots = (
    translate: (values: Record<string, string>) => string,
    nodes: Record<string, ReactNode>,
): ReactNode => {
    const values = Object.fromEntries(
        Object.keys(nodes).map((name) => [name, `${MARK}${name}${MARK}`]),
    )
    return translate(values)
        .split(new RegExp(`${MARK}(\\w+)${MARK}`))
        .map((part, index) =>
            index % 2 === 0 ? part : <Fragment key={index}>{nodes[part]}</Fragment>,
        )
}
