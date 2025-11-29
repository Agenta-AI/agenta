import type {MouseEvent} from "react"

import {
    buildAppScopedUrl,
    buildEvaluationNavigationUrl,
} from "@/agenta-oss-common/components/pages/evaluations/utils"
import {getDefaultStore} from "jotai"
import Router from "next/router"

import {message} from "@/oss/components/AppMessageContext"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
// import {, buildEvaluationNavigationUrl} from "@/oss/pages/evaluations/utils"
import {routerAppIdAtom} from "@/oss/state/app"
import {urlAtom, waitForValidURL, type URLState} from "@/oss/state/url"

import type {EvaluationRunKind, EvaluationRunTableRow} from "../types"
import {resolveRowAppId} from "../utils/runHelpers"

const store = getDefaultStore()

const getUrlState = (): URLState => store.get(urlAtom) as URLState

const getActiveAppId = (): string | null => store.get(routerAppIdAtom)

export const shouldIgnoreRowClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    if (!target) return false
    const interactiveSelector =
        "button, a, input, textarea, select, [role='button'], [role='menuitem'], [role='checkbox'], .ant-checkbox, .ant-checkbox-input, .ant-checkbox-inner, .ant-checkbox-wrapper, .ant-btn, .ant-select, .ant-dropdown-trigger"
    return Boolean(target.closest(interactiveSelector))
}

interface NavigateToRunParams {
    record: EvaluationRunTableRow
    scope: "app" | "project"
    evaluationKind: EvaluationRunKind
}

export const navigateToRun = async ({record, scope, evaluationKind}: NavigateToRunParams) => {
    const {baseAppURL, projectURL} = await waitForValidURL({
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

    const pathname = buildEvaluationNavigationUrl({
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
    const {baseAppURL} = await waitForValidURL({requireProject: true, requireApp: true})

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

    void Router.push({
        pathname: buildAppScopedUrl(baseAppURL, targetAppId, "/playground"),
        query: {revisions: buildRevisionsQueryParam([revisionId])},
    })
}

export const navigateToTestset = (testsetId: string) => {
    const {projectURL} = getUrlState()

    if (!testsetId) {
        message.warning("Testset information is unavailable for this run.")
        return
    }

    if (!projectURL) {
        message.warning("Project URL is not ready yet. Try again in a moment.")
        return
    }

    void Router.push(`${projectURL}/testsets/${encodeURIComponent(testsetId)}`)
}
