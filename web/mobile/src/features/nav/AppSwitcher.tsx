import {useCallback, useMemo, useState} from "react"

import {
    promptWorkflowsListQueryStateAtom,
    workflowDetailQueryAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {WorkflowPickerView, type WorkflowPickerEntry} from "@agenta/navigation-ui"
import {CheckIcon, SquaresFourIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import {atom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

const NO_APPS = atom({data: [] as Workflow[], isPending: false, isError: false, error: null})

/** The page to open for another app: the same page, so switching keeps the reader in place. */
export const appSwitchHref = (
    projectURL: string,
    pathname: string,
    query: Record<string, string | string[] | undefined>,
    nextAppId: string,
): string => {
    const page = pathname.match(/\/apps\/\[app_id\]\/([^/]+)$/)?.[1]
    if (page) return `${projectURL}/apps/${nextAppId}/${page}`
    const projectPage = pathname.match(/\/(variants|endpoints)$/)?.[1] ?? "variants"
    // The revision and environment belong to the old app; only the tab carries over.
    const tab = typeof query.tab === "string" ? `&tab=${encodeURIComponent(query.tab)}` : ""
    return `${projectURL}/${projectPage}?app=${encodeURIComponent(nextAppId)}${tab}`
}

/** An app's square, name and type, as the old app's app menu shows it. */
const AppIdentity = ({
    name,
    showDetails = true,
    selected,
}: {
    name: string
    showDetails?: boolean
    selected?: boolean
}) => (
    <div className={clsx("flex w-full min-w-0 items-center", showDetails ? "gap-2" : "gap-0")}>
        <span
            className={clsx(
                "flex shrink-0 items-center justify-center bg-colorInfoBg text-colorInfo",
                showDetails ? "h-8 w-8 rounded-lg" : "h-6 w-6 rounded-md",
            )}
        >
            <SquaresFourIcon size={showDetails ? 17 : 14} />
        </span>
        {showDetails ? (
            <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate text-sm leading-5" title={name}>
                    {name}
                </span>
                <span className="text-[12px] leading-3 text-colorTextTertiary">Prompt</span>
            </span>
        ) : null}
        {selected ? <CheckIcon size={16} className="shrink-0" /> : null}
    </div>
)

/**
 * The app menu's switcher: the shared picker over the project's prompt apps. The list loads the
 * first time the menu opens; until then only the current app is read.
 */
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
