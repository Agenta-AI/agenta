import {useCallback, useMemo, useState} from "react"

import {
    nonDeterministicEvaluatorsAtom,
    promptWorkflowsListQueryStateAtom,
    workflowDetailQueryAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {WorkflowPickerView, type WorkflowPickerEntry} from "@agenta/navigation-ui"
import {atom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {AppIdentity} from "./AppIdentity"

const NO_APPS = atom({data: [] as Workflow[], isPending: false, isError: false, error: null})
const NO_EVALUATORS = atom<Workflow[]>([])

/** The pages an evaluator has under `/apps/<id>/`; its playground is the evaluator playground. */
const EVALUATOR_PAGES = new Set(["overview", "evaluations", "traces"])

/**
 * The same page of another app, so switching keeps the reader in place; Registry keeps its tab.
 * An evaluator has no Registry, API or app playground: those pages switch to its Overview.
 */
export const appSwitchHref = (
    projectURL: string,
    pathname: string,
    query: Record<string, string | string[] | undefined>,
    nextAppId: string,
    toEvaluator = false,
): string => {
    const current = pathname.match(/\/apps\/\[app_id\]\/([^/]+)$/)?.[1] ?? "overview"
    const page = toEvaluator && !EVALUATOR_PAGES.has(current) ? "overview" : current
    const tab =
        page === "variants" && typeof query.tab === "string"
            ? `?tab=${encodeURIComponent(query.tab)}`
            : ""
    return `${projectURL}/apps/${encodeURIComponent(nextAppId)}/${page}${tab}`
}

/**
 * The app menu's switcher over the prompt apps and the evaluators that have their own pages (the
 * non-deterministic ones, as in the old app), newest first. The lists load on first open.
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
    const evaluators = useAtomValue(listWanted ? nonDeterministicEvaluatorsAtom : NO_EVALUATORS)
    const app = current.data
    const name = app ? app.name || app.slug || app.id : ""

    const choices = useMemo(
        () =>
            [
                ...apps.map((entry) => ({entry, evaluator: false})),
                ...evaluators.map((entry) => ({entry, evaluator: true})),
            ].sort(
                (a, b) =>
                    (Date.parse(b.entry.updated_at ?? b.entry.created_at ?? "") || 0) -
                    (Date.parse(a.entry.updated_at ?? a.entry.created_at ?? "") || 0),
            ),
        [apps, evaluators],
    )

    const entries = useMemo<WorkflowPickerEntry[]>(
        () =>
            choices.map(({entry, evaluator}) => ({
                key: entry.id,
                href: appSwitchHref(projectURL, router.pathname, router.query, entry.id, evaluator),
                content: (
                    <AppIdentity
                        name={entry.name || entry.slug || entry.id}
                        evaluator={evaluator}
                        selected={entry.id === appId}
                    />
                ),
            })),
        [appId, choices, projectURL, router.pathname, router.query],
    )

    const onSelect = useCallback(
        (key: string) => {
            setOpen(false)
            const choice = choices.find(({entry}) => entry.id === key)
            if (key !== appId && choice) {
                void router.push(
                    appSwitchHref(projectURL, router.pathname, router.query, key, choice.evaluator),
                )
            }
        },
        [appId, choices, projectURL, router, setOpen],
    )

    return (
        <WorkflowPickerView
            collapsed={collapsed}
            open={open}
            onOpenChange={setOpen}
            entries={entries}
            onSelect={onSelect}
            ariaLabel="Switch app"
            triggerContent={
                <AppIdentity
                    name={name}
                    evaluator={Boolean(app?.flags?.is_evaluator)}
                    showDetails={!collapsed}
                />
            }
        />
    )
}
