import {formatPageTitle} from "@agenta/shared/utils"
import Head from "next/head"

/**
 * The tab name, in one place — the SAME formatter the desktop uses, so a tab reads identically
 * on both surfaces: `Section | Entity`, falling back to `Section | Agenta` when a screen names
 * no entity, and to `Agenta` alone when it names neither.
 */
export const PageTitle = ({
    title,
    context,
}: {
    /** What this screen is. Omit only on a route that has not resolved yet. */
    title?: string | null
    /** What it is about — the agent, the template. Defaults to the product name. */
    context?: string | null
}) => (
    <Head>
        <title>{formatPageTitle(title, context)}</title>
    </Head>
)
