import {useState} from "react"

import {ALL_TEMPLATES_CATEGORY} from "@agenta/entities/workflow"
import {TemplateGallery} from "@agenta/home-ui"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {useNewAgentAction} from "./useNewAgentAction"

/**
 * The full template catalogue — where the New agent menu's "Browse all templates" lands.
 *
 * The SHARED gallery does the browsing (rail, search, sections, cards) AND names the page, so this
 * screen adds no header of its own: a second bar would just repeat the title. The drawer trigger
 * rides in the gallery's `leading` slot.
 *
 * `ScreenScaffold fill` is the shape — the scaffold owns the viewport height and the insets, the
 * gallery owns the scrolling inside it. Hand-rolling that column here would fork the screen shape.
 *
 * Picking a card creates from it, because there is no detail page here to send you to first — the
 * same thing the menu's template entries do.
 */
export const AgentTemplatesScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`
    const newAgent = useNewAgentAction(base)
    const [category, setCategory] = useState(ALL_TEMPLATES_CATEGORY)

    return (
        <>
            <PageTitle title="Templates" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill
                    // Only while something is happening — nothing renders at rest.
                    header={
                        newAgent.creating || newAgent.error ? (
                            <div className="border-border shrink-0 border-b px-4 py-2 text-xs">
                                {newAgent.error ? (
                                    <span className="text-destructive">{newAgent.error}</span>
                                ) : (
                                    <span className="text-muted-foreground">Creating agent…</span>
                                )}
                            </div>
                        ) : undefined
                    }
                >
                    <TemplateGallery
                        leading={<NavDrawer workspaceId={workspaceId} projectId={projectId} />}
                        category={category}
                        onCategoryChange={setCategory}
                        // A card OPENS the template, as on the desktop: the detail page is where you
                        // see what it needs before committing to it.
                        onSelectTemplate={(template) =>
                            void router.push(`${base}/templates/${template.key}`)
                        }
                    />
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
