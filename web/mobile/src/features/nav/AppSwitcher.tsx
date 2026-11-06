import {useCallback, useMemo, useState} from "react"

import {
    promptWorkflowsListQueryStateAtom,
    workflowDetailQueryAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {WorkflowPickerView, type WorkflowPickerEntry} from "@agenta/navigation-ui"
import {atom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {AppIdentity} from "./AppIdentity"

const NO_APPS = atom({data: [] as Workflow[], isPending: false, isError: false, error: null})

/** The same page of another app, so switching keeps the reader in place; Registry keeps its tab. */
export const appSwitchHref = (
    projectURL: string,
    pathname: string,
    query: Record<string, string | string[] | undefined>,
    nextAppId: string,
): string => {
    const page = pathname.match(/\/apps\/\[app_id\]\/([^/]+)$/)?.[1] ?? "overview"
    const tab =
        page === "variants" && typeof query.tab === "string"
            ? `?tab=${encodeURIComponent(query.tab)}`
            : ""
    return `${projectURL}/apps/${encodeURIComponent(nextAppId)}/${page}${tab}`
}

/** The app menu's switcher over the prompt apps; the list loads on first open. */
export const AppSwitcher = ({
    projectURL,
    appId,
    collapsed,
}: {
    projectURL: string
    appId: string
    collapsed: boolean
}) => {
    const router = useRouter()
    const [open, setOpenState] = useState(false)
    const [listWanted, setListWanted] = useState(false)
    const setOpen = useCallback((next: boolean) => {
        setOpenState(next)
        if (next) setListWanted(true)
    }, [])
    const current = useAtomValue(workflowDetailQueryAtomFamily(appId))
    const apps = useAtomValue(listWanted ? promptWorkflowsListQueryStateAtom : NO_APPS).data
    const app = current.data
    const name = app ? app.name || app.slug || app.id : ""

    const entries = useMemo<WorkflowPickerEntry[]>(
        () =>
            [...apps]
                .sort(
                    (a, b) =>
                        Date.parse(b.updated_at ?? b.created_at ?? "") -
                        Date.parse(a.updated_at ?? a.created_at ?? ""),
                )
                .map((entry) => ({
                    key: entry.id,
                    href: appSwitchHref(projectURL, router.pathname, router.query, entry.id),
                    content: (
                        <AppIdentity
                            name={entry.name || entry.slug || entry.id}
                            selected={entry.id === appId}
                        />
                    ),
                })),
        [appId, apps, projectURL, router.pathname, router.query],
    )

    const onSelect = useCallback(
        (key: string) => {
            setOpen(false)
            if (key !== appId) {
                void router.push(appSwitchHref(projectURL, router.pathname, router.query, key))
            }
        },
        [appId, projectURL, router, setOpen],
    )

    return (
        <WorkflowPickerView
            collapsed={collapsed}
            open={open}
            onOpenChange={setOpen}
            entries={entries}
            onSelect={onSelect}
            ariaLabel="Switch app"
            triggerContent={<AppIdentity name={name} showDetails={!collapsed} />}
        />
    )
}
