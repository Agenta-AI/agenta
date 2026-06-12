import {injectedUrlAtom, injectedRouterAppIdAtom} from "@agenta/evaluations/state"
import type {InjectedUrlState} from "@agenta/evaluations/state"
import type {EvaluationRunKind, EvaluationRunTableRow} from "@agenta/evaluations/state/runsTable"
import {resolveRowAppId} from "@agenta/evaluations/state/runsTable"
import {message} from "@agenta/ui/app-message"
import {getDefaultStore} from "jotai"
import Router from "next/router"

import {getEvalViewFns} from "../../../host/fnRegistry"

const store = getDefaultStore()

const getUrlState = (): InjectedUrlState => store.get(injectedUrlAtom)

const getActiveAppId = (): string | null => store.get(injectedRouterAppIdAtom)

interface NavigateToRunParams {
    record: EvaluationRunTableRow
    scope: "app" | "project"
    evaluationKind: EvaluationRunKind
}

export const navigateToRun = async ({record, scope, evaluationKind}: NavigateToRunParams) => {
    const {baseAppURL, projectURL} = await getEvalViewFns().waitForValidURL({
        requireProject: true,
        requireApp: scope === "app",
    })

    const runId = record.preview?.id ?? record.runId
    if (!runId || record.__isSkeleton) return

    const appIdForRun = resolveRowAppId(record, getActiveAppId())
    if (scope === "app" && !appIdForRun) {
        message.warning("Unable to open run details. Missing application context.")
        return
    }

    if (scope === "app" && !baseAppURL) {
        message.warning("App URL is not ready yet. Try again in a moment.")
        return
    }

    if (!projectURL) {
        message.warning("Project URL is not ready yet. Try again in a moment.")
        return
    }

    const pathname = getEvalViewFns().buildEvaluationNavigationUrl({
        scope,
        baseAppURL: baseAppURL ?? "",
        projectURL,
        appId: scope === "app" ? (appIdForRun ?? undefined) : undefined,
        path: `/evaluations/results/${encodeURIComponent(runId)}`,
    })

    const resolvedKind =
        evaluationKind === "all" ? (record.evaluationKind ?? "auto") : evaluationKind
    const query: Record<string, string> = {}
    if (resolvedKind) {
        query.type = resolvedKind
    }
    if (scope === "project" && appIdForRun) {
        query.app_id = appIdForRun
    }

    void Router.push({pathname, query})
}

interface NavigateToVariantParams {
    revisionId: string
    appId?: string | null
}

export const navigateToVariant = async ({revisionId, appId}: NavigateToVariantParams) => {
    const {baseAppURL} = await getEvalViewFns().waitForValidURL({
        requireProject: true,
        requireApp: true,
    })

    if (!revisionId) {
        message.warning("This run does not have an accessible variant yet.")
        return
    }

    const targetAppId = appId ?? getActiveAppId() ?? null
    if (!targetAppId) {
        message.warning("Unable to determine which application owns this variant.")
        return
    }

    if (!baseAppURL) {
        message.warning("Application URL is not ready yet. Try again in a moment.")
        return
    }

    const fns = getEvalViewFns()
    void Router.push({
        pathname: fns.buildAppScopedUrl(baseAppURL, targetAppId, "/playground"),
        query: {revisions: fns.buildRevisionsQueryParam([revisionId]) ?? ""},
    })
}

export const navigateToTestset = (testsetId: string, revisionId?: string | null) => {
    const {projectURL} = getUrlState()

    if (!testsetId) {
        message.warning("Testset information is unavailable for this run.")
        return
    }

    if (!projectURL) {
        message.warning("Project URL is not ready yet. Try again in a moment.")
        return
    }

    // Use revision ID for URL if available, otherwise fall back to testset ID
    const targetId = revisionId ?? testsetId
    void Router.push(`${projectURL}/testsets/${encodeURIComponent(targetId)}`)
}
