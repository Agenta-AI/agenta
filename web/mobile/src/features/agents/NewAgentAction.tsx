import {useRouter} from "next/router"

import {AGENT_TEMPLATES} from "@agenta/entities/workflow"
import {NewAgentButton} from "@agenta/home-ui"

/**
 * The SHARED create button, bound to this app's create — blank or from a starter template, off the
 * SAME catalogue the desktop offers.
 *
 * "Browse all templates" points at this app's own gallery route, which renders the SAME shared
 * gallery the desktop does. That route sits at the project root, NOT under `/agents`: the sidebar
 * matches a nav entry by path PREFIX, so a gallery under `/agents/...` lit the Agents entry the
 * whole time you were browsing templates.
 */
export const NewAgentAction = ({
    create,
    createFromTemplate,
    creating,
    error,
    label,
    base,
    align = "stretch",
}: {
    create: () => void
    createFromTemplate: (templateKey: string) => void
    creating: boolean
    error: string | null
    label?: string
    /** `/w/:workspace/p/:project` — the gallery link's base. */
    base: string
    /**
     * How the button sits in its container. A header row wants it hugging the right edge; a rail
     * wants it filling the column like the controls under it — hardcoding either one misplaces it
     * on the other surface.
     */
    align?: "end" | "stretch"
}) => {
    const router = useRouter()

    return (
        <span className={`flex flex-col gap-1 ${align === "end" ? "items-end" : "items-stretch"}`}>
            <NewAgentButton
                label={label}
                loading={creating}
                onCreateBlank={create}
                templates={AGENT_TEMPLATES}
                // A menu has nowhere to show the connect step, so a pick OPENS the template instead of
                // creating from it — the detail screen asks for what it needs, as every other surface
                // does. Picking a template used to be the one route that skipped the question.
                onPickTemplate={(templateKey: string) =>
                    void router.push(`${base}/templates/${templateKey}`)
                }
                browseHref={`${base}/templates`}
            />
            {error ? <span className="text-destructive text-[11px]">{error}</span> : null}
        </span>
    )
}
