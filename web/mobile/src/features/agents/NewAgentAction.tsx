import {AGENT_TEMPLATES} from "@agenta/entities/workflow"
import {NewAgentButton} from "@agenta/home-ui"
import {useRouter} from "next/router"

/**
 * The SHARED create button, bound to this app's create surface (`/agents/new`) — every entry
 * lands on the same structure: blank shows the template strip, a template pick arrives with
 * `?template=` and gets the connect step in the strip's place. Nothing creates from here
 * directly, so there is no in-place creating state to show.
 *
 * "Browse all templates" points at this app's own gallery route, which renders the SAME shared
 * gallery the desktop does. That route sits at the project root, NOT under `/agents`: the sidebar
 * matches a nav entry by path PREFIX, so a gallery under `/agents/...` lit the Agents entry the
 * whole time you were browsing templates.
 */
export const NewAgentAction = ({
    label,
    base,
    align = "stretch",
}: {
    label?: string
    /** `/w/:workspace/p/:project` — the create surface and gallery links' base. */
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
                onCreateBlank={() => void router.push(`${base}/agents/new`)}
                templates={AGENT_TEMPLATES}
                onPickTemplate={(templateKey: string) =>
                    void router.push(`${base}/agents/new?template=${templateKey}`)
                }
                browseHref={`${base}/templates`}
            />
        </span>
    )
}
