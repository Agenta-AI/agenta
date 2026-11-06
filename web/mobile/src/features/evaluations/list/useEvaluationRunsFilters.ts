import {useCallback} from "react"

import type {EvaluationRunKind} from "@agenta/entities/evaluationRun"

import {useRouteAppId} from "../../developer/useRouteAppId"
import {useUrlParams} from "../../developer/useUrlParams"

export type EvaluationKindTab = "all" | EvaluationRunKind

export const KIND_TABS: readonly EvaluationKindTab[] = ["all", "auto", "human", "online", "custom"]

export const RUN_STATUS_OPTIONS = [
    {value: "pending", label: "Pending"},
    {value: "queued", label: "Queued"},
    {value: "running", label: "Running"},
    {value: "success", label: "Success"},
    {value: "failure", label: "Failure"},
    {value: "errors", label: "Errors"},
    {value: "cancelled", label: "Cancelled"},
] as const

/** An unknown value reads as `all`. A live run belongs to no single app, so app scope drops it. */
export const parseKindTab = (raw: string | null, appScoped: boolean): EvaluationKindTab => {
    const kind = KIND_TABS.find((tab) => tab === raw) ?? "all"
    return appScoped && kind === "online" ? "all" : kind
}

/** The known statuses of a comma list, in the menu's order. */
export const parseStatuses = (raw: string | null): string[] => {
    const wanted = new Set((raw ?? "").split(",").map((value) => value.trim()))
    return RUN_STATUS_OPTIONS.map((option) => option.value).filter((value) => wanted.has(value))
}

/** The runs list's filters, kept in the URL so a link or a reload shows the same list. */
export const useEvaluationRunsFilters = () => {
    const {read, write} = useUrlParams()
    const {appId, fromPath: appFromPath} = useRouteAppId()
    const search = read("q") ?? ""
    const statuses = parseStatuses(read("status"))
    const kind = parseKindTab(read("kind"), appId !== null)

    const setKind = useCallback(
        (next: EvaluationKindTab) => write({kind: next === "all" ? null : next}),
        [write],
    )
    const setAppId = useCallback((next: string | null) => write({app: next}), [write])
    const setSearch = useCallback((next: string) => write({q: next.trim() ? next : null}), [write])
    const setStatuses = useCallback(
        (next: readonly string[]) => write({status: next.length > 0 ? next.join(",") : null}),
        [write],
    )
    const clearFilters = useCallback(() => write({q: null, status: null}), [write])

    return {
        kind,
        appId,
        appFromPath,
        search,
        statuses,
        setKind,
        setAppId,
        setSearch,
        setStatuses,
        clearFilters,
    }
}
