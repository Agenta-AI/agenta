import {useState} from "react"

import {ALL_TEMPLATES_CATEGORY} from "@agenta/entities/workflow"
import {TEMPLATE_GALLERY_COPY, TemplateGallery} from "@agenta/home-ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {BROWSE_LAYOUT, BROWSE_RAIL_MODE} from "@/lib/browseLayout"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

/**
 * The full template catalogue — where the New agent menu's "Browse all templates" lands.
 *
 * The SHARED gallery does the browsing (search, categories, sections, cards). In the toolbar
 * layout it leaves identity to its host, so this screen carries the title and the drawer trigger;
 * in the rail layout the gallery names the page itself and takes the trigger in `leading`.
 *
 * `ScreenScaffold fill` is the shape — the scaffold owns the viewport height and the insets, the
 * gallery owns the scrolling inside it. Hand-rolling that column here would fork the screen shape.
 *
 * Picking a card opens the template's detail page — the create itself always happens on the
 * create surface (`/agents/new?template=`), which the detail's "Use this template" leads to.
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
    const [category, setCategory] = useState(ALL_TEMPLATES_CATEGORY)

    return (
        <>
            <PageTitle title="Templates" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill
                    // The identity row the toolbar layout leaves to its host (the rail carries
                    // its own).
                    header={
                        BROWSE_RAIL_MODE ? undefined : (
                            <div
                                className={`${pageContentWidthClass} flex shrink-0 flex-col gap-1 px-4 pb-3 pt-2 lg:px-16 lg:pt-14`}
                            >
                                <div className="flex items-center gap-2">
                                    <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                    <h1 className="m-0 text-[24px] font-semibold leading-[1.3333333333333333]">
                                        {TEMPLATE_GALLERY_COPY.title}
                                    </h1>
                                </div>
                                {/* The toolbar frame leaves identity to the host, and the
                                    desktop's `PageLayout` renders this line — without it /m
                                    was the only surface that never said what the page is for. */}
                                <p className="text-muted-foreground m-0 text-[13px]">
                                    {TEMPLATE_GALLERY_COPY.subtitle}
                                </p>
                            </div>
                        )
                    }
                >
                    {/* The toolbar frame's body shares the header's column — the page cap and the
                        gutters go on BOTH boxes or the grid runs past the viewport with the cards
                        clipped at the right edge. The rail frame bleeds to the edge by design. */}
                    <div
                        className={
                            BROWSE_RAIL_MODE
                                ? "flex min-h-0 flex-1 flex-col"
                                : `${pageContentWidthClass} flex min-h-0 flex-1 flex-col px-4 pb-4 lg:px-16 lg:pb-8`
                        }
                    >
                        <TemplateGallery
                            // Toolbar by default (#5846): a rail here would be a second sidebar
                            // beside the nav one, so identity moves to this screen's header above.
                            // With the flag on, the rail returns and carries its own title and
                            // drawer trigger.
                            layout={BROWSE_LAYOUT}
                            leading={
                                BROWSE_RAIL_MODE ? (
                                    <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                ) : undefined
                            }
                            category={category}
                            onCategoryChange={setCategory}
                            // A card OPENS the template, as on the desktop: the detail page is
                            // where you see what it needs before committing to it.
                            onSelectTemplate={(template) =>
                                void router.push(`${base}/templates/${template.key}`)
                            }
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
