import {useCallback, useEffect, useRef} from "react"

import {getSettingsTabVariant, type SettingsTabKey} from "@agenta/settings"
import {SettingsPageShell} from "@agenta/settings-ui"
import {useScrollFadeEdges} from "@agenta/ui/hooks"
import {useRouter} from "next/router"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {isNestedSettingsNavEnabled} from "./nestedNav"
import {useSettingsNavScope} from "./settingsNavScope"
import {SettingsTabContent} from "./SettingsTabContent"
import {SettingsTabRail} from "./SettingsTabRail"
import {preloadAllSettingsTabs, preloadSettingsTab} from "./settingsTabRegistry"
import {useActiveSettingsTab, useMobileSettingsAccess} from "./settingsTabs"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {
    getMobileSettingsTabDescription,
    getMobileSettingsTabDocs,
    getMobileSettingsTabLabel,
} from "@/lib/integrationsCopy"

/** Warms a tab's code when the pointer reaches its nav link, and every tab once the page is idle. */
const usePreloadSettingsTabs = () => {
    useEffect(() => {
        const onPointerOver = (event: PointerEvent) => {
            const link = (event.target as Element | null)?.closest?.("a[href*='settings?tab=']")
            const tab = link && new URL((link as HTMLAnchorElement).href).searchParams.get("tab")
            if (tab) preloadSettingsTab(tab)
        }
        document.addEventListener("pointerover", onPointerOver)
        const idle = window.requestIdleCallback
            ? window.requestIdleCallback(preloadAllSettingsTabs, {timeout: 4_000})
            : window.setTimeout(preloadAllSettingsTabs, 2_000)
        return () => {
            document.removeEventListener("pointerover", onPointerOver)
            if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
            else window.clearTimeout(idle)
        }
    }, [])
}

/**
 * Settings on /m: the desktop's own tab model, with one tab open at a time.
 *
 * By default the settings nav TAKES OVER the main sidebar exactly as oss/ee do — no second rail,
 * no in-page top bar, the content pane starts at the tab title. `NEXT_PUBLIC_SETTINGS_NESTED_NAV`
 * brings back the nested rail beside the main one.
 *
 * Every page is the shared one. This host is read-only — it brings no create/edit dialogs — so
 * the rail lists what it can show and each page renders without its write affordances.
 */
export const SettingsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    usePreloadSettingsTabs()

    const nestedNav = isNestedSettingsNavEnabled()
    const settingsScope = useSettingsNavScope(workspaceId, projectId)
    const access = useMobileSettingsAccess()
    const active = useActiveSettingsTab()

    const selectTab = useCallback(
        (tab: SettingsTabKey) =>
            void router.replace({query: {...router.query, tab}}, undefined, {shallow: true}),
        [router],
    )

    // Every tab's body fades at an edge with more to scroll, top and bottom.
    const scrollRef = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(scrollRef)

    const content = (
        // Does not scroll: the shell keeps the title still and scrolls only its body.
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SettingsPageShell
                scrollRef={scrollRef}
                scrollClassName="ag-scroll-fade"
                variant={getSettingsTabVariant(active)}
                title={getMobileSettingsTabLabel(active, access)}
                description={getMobileSettingsTabDescription(active, access)}
                docs={getMobileSettingsTabDocs(active)}
            >
                <SettingsTabContent tab={active} workspaceId={workspaceId} projectId={projectId} />
            </SettingsPageShell>
        </div>
    )

    return (
        <>
            <PageTitle title="Settings" />
            <AppShell
                workspaceId={workspaceId}
                projectId={projectId}
                scope={nestedNav ? undefined : settingsScope}
            >
                <ScreenScaffold
                    fill
                    header={
                        nestedNav ? (
                            <div className="border-border shrink-0 border-0 border-b border-solid px-2 pb-3 pt-2 lg:px-8">
                                <ContentRail className="flex items-center gap-2 lg:max-w-none">
                                    <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                    <h1 className="m-0 text-sm font-semibold">Settings</h1>
                                </ContentRail>
                            </div>
                        ) : (
                            // Takeover has no top bar of its own. Below lg the rail is a drawer,
                            // so the page needs the way into it — and a name beside it, or the
                            // bar reads as a stray button. "Settings", not the tab: the tab's
                            // own title is the page heading directly underneath.
                            <div className="border-border shrink-0 border-0 border-b border-solid px-2 py-2 lg:hidden">
                                <div className="flex items-center gap-2">
                                    <NavDrawer
                                        workspaceId={workspaceId}
                                        projectId={projectId}
                                        scope={settingsScope}
                                    />
                                    <h1 className="m-0 text-sm font-semibold">Settings</h1>
                                </div>
                            </div>
                        )
                    }
                >
                    {nestedNav ? (
                        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                            <SettingsTabRail active={active} onSelect={selectTab} />
                            {content}
                        </div>
                    ) : (
                        content
                    )}
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
