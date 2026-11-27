import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {getSettingsTabVariant, type SettingsTabKey} from "@agenta/settings"
import {
    SettingsHeaderActionsProvider,
    SettingsPageDescription,
    SettingsPageShell,
    SettingsToolbarSlotProvider,
    SettingsVideoButton,
} from "@agenta/settings-ui"
import {useScrollFadeEdges} from "@agenta/ui/hooks"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {getMobileSettingsTabLabel} from "@/lib/integrationsCopy"
import {
    getMobileSettingsTabDescription,
    getMobileSettingsTabDocs,
} from "@/lib/integrationsTabDetails"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {openFeatureGuideAtom} from "../education/featureGuideAtom"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {PageLayout} from "../page-layout/PageLayout"

import {LicenseNotices} from "./LicenseNotices"
import {isNestedSettingsNavEnabled} from "./nestedNav"
import {useSettingsNavScope} from "./settingsNavScope"
import {SettingsTabContent} from "./SettingsTabContent"
import {SettingsTabRail} from "./SettingsTabRail"
import {preloadAllSettingsTabs, preloadSettingsTab} from "./settingsTabRegistry"
import {useActiveSettingsTab, useMobileSettingsAccess} from "./settingsTabs"
import {SETTINGS_WALKTHROUGHS} from "./settingsWalkthroughs"

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
 * By default the settings nav takes over the main sidebar and the tab is a general page
 * (`PageLayout`): the tab's title row, its action in the compact bar below lg.
 * `NEXT_PUBLIC_SETTINGS_NESTED_NAV` brings back the nested rail beside the main one.
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
    const t = useT(commonCatalog, navigationCatalog)
    useBindProjectContext(projectId)
    const router = useRouter()
    usePreloadSettingsTabs()

    const nestedNav = isNestedSettingsNavEnabled()
    const settingsScope = useSettingsNavScope(workspaceId, projectId)
    const access = useMobileSettingsAccess()
    const active = useActiveSettingsTab()

    const selectTab = useCallback(
        (tab: SettingsTabKey) =>
            void router.replace(
                {pathname: router.pathname, query: {...router.query, tab}},
                undefined,
                {shallow: true},
            ),
        [router],
    )

    // Every tab's body fades at an edge with more to scroll, top and bottom.
    const scrollRef = useRef<HTMLDivElement>(null)
    // A pinned catalog search keeps its colour; the top fade starts below it.
    useScrollFadeEdges(scrollRef, {insetSelector: "[data-sticky-search]"})
    // A new tab opens at its top, not at the previous tab's scroll offset.
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0
    }, [active])

    const openWalkthrough = useSetAtom(openFeatureGuideAtom)
    const walkthrough = SETTINGS_WALKTHROUGHS[active]
    const video = walkthrough
        ? {
              label: t("navigation.settings.watchWalkthrough"),
              onOpen: () => openWalkthrough(walkthrough),
          }
        : undefined
    // Where a tab portals its primary action: the compact bar, or the title row on lg.
    const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)
    // Where a tab portals its toolbar: pinned under the title, drawn only while a tab has one.
    const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
    const [toolbarCount, setToolbarCount] = useState(0)
    const registerToolbar = useCallback(() => {
        setToolbarCount((count) => count + 1)
        return () => setToolbarCount((count) => count - 1)
    }, [])
    const toolbarSlot = useMemo(
        () => ({target: toolbarTarget, register: registerToolbar}),
        [toolbarTarget, registerToolbar],
    )

    // The default: the settings nav takes over the sidebar and the page is a general page.
    if (!nestedNav) {
        return (
            <PageLayout
                workspaceId={workspaceId}
                projectId={projectId}
                scope={settingsScope}
                title={getMobileSettingsTabLabel(active, access)}
                documentTitle={t("common.settings")}
                description={
                    // An element skips PageLayout's own text style, so it is set here.
                    <p className="m-0 mt-1 text-body text-muted-foreground">
                        <SettingsPageDescription
                            description={getMobileSettingsTabDescription(active, access)}
                            docs={getMobileSettingsTabDocs(active)}
                        />
                    </p>
                }
                actions={
                    <>
                        {video ? <SettingsVideoButton video={video} /> : null}
                        <div
                            ref={setActionsSlot}
                            className="flex items-center gap-2 empty:hidden"
                        />
                    </>
                }
                toolbar={toolbarCount > 0 ? <div ref={setToolbarTarget} /> : undefined}
                scrollRef={scrollRef}
                scrollClassName="ag-scroll-fade"
            >
                <SettingsToolbarSlotProvider value={toolbarSlot}>
                    <SettingsHeaderActionsProvider value={actionsSlot}>
                        {/* The tab body's own frame from SettingsPageShell: a column on the body text. */}
                        <div className="flex flex-col pb-4 text-body">
                            <SettingsTabContent
                                tab={active}
                                workspaceId={workspaceId}
                                projectId={projectId}
                            />
                        </div>
                    </SettingsHeaderActionsProvider>
                </SettingsToolbarSlotProvider>
            </PageLayout>
        )
    }

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
                video={video}
            >
                <LicenseNotices projectId={projectId} />
                <SettingsTabContent tab={active} workspaceId={workspaceId} projectId={projectId} />
            </SettingsPageShell>
        </div>
    )

    return (
        <>
            <PageTitle title={t("common.settings")} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill
                    header={
                        <div className="border-border shrink-0 border-0 border-b border-solid px-2 pb-3 pt-2 lg:px-8">
                            <ContentRail className="flex items-center gap-2 lg:max-w-none">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 text-title">{t("common.settings")}</h1>
                            </ContentRail>
                        </div>
                    }
                >
                    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                        <SettingsTabRail active={active} onSelect={selectTab} />
                        {content}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
