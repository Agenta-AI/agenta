import {formatPageTitle} from "@agenta/shared/utils"
import Head from "next/head"

export interface PageTitleProps {
    /**
     * What this screen is. `undefined` means "not resolved yet" and renders NO `<title>`, so Next's
     * head dedupe lets the nearest resolved title stand instead of flapping through the bare
     * product name for a frame. `null` and `""` mean "this screen names nothing" and do render it.
     */
    title?: string | null
    /** What it is about — the agent, the workflow. Defaults to the product name. */
    context?: string | null
}

/**
 * The tab name, in one place — the SAME formatter on both surfaces, so a tab reads identically:
 * `Section | Entity`, falling back to `Section | Agenta` when a screen names no entity, and to
 * `Agenta` alone when it names neither.
 */
export const PageTitle = ({title, context}: PageTitleProps) => {
    if (title === undefined) return null

    return (
        <Head>
            <title>{formatPageTitle(title, context)}</title>
        </Head>
    )
}

export default PageTitle
