import {Shield} from "@phosphor-icons/react"

import {ChangedPathsProvider, type ChangedPaths} from "../../../../drawers/shared"

import {ModelHarnessSectionBody, type ModelHarnessBodyProps} from "./ModelHarnessSectionBody"
import type {AgentTemplateT, ModelHarness, SectionIndicatorFor, SectionResult} from "./types"

export interface PermissionsSectionParams {
    t: AgentTemplateT
    mh: ModelHarness
    sectionIndicator: SectionIndicatorFor
    panelChangedPaths: ChangedPaths
    bodyProps: ModelHarnessBodyProps
}

/** The agent-wide permission policy (`runner.permissions.default`). */
export const permissionsSection = ({
    t,
    mh,
    sectionIndicator,
    panelChangedPaths,
    bodyProps,
}: PermissionsSectionParams): SectionResult => {
    if (!mh.hasPermissions) return false
    const policy = (
        <ChangedPathsProvider changes={panelChangedPaths}>
            <ModelHarnessSectionBody section="permissions" {...bodyProps} />
        </ChangedPathsProvider>
    )
    return {
        key: "permissions",
        icon: <Shield size={14} />,
        title: t("entityUi.agentTemplate.permissions"),
        summary: mh.runnerPermissionSummary,
        // The phone row names the policy only ("Allow reads", M07).
        phoneSummary: mh.runnerPermissionLabel,
        indicator: sectionIndicator("permissions"),
        // Closed: the row opens the policy inline (canvas S02, F04 f8).
        defaultOpen: false,
        content: policy,
    }
}
