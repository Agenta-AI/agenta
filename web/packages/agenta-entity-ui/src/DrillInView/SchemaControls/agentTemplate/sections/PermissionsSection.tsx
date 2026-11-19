import {ShieldCheck} from "@phosphor-icons/react"

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
}: PermissionsSectionParams): SectionResult =>
    mh.hasPermissions && {
        key: "permissions",
        icon: <ShieldCheck size={16} />,
        title: t("entityUi.agentTemplate.permissions"),
        summary: mh.runnerPermissionSummary,
        indicator: sectionIndicator("permissions"),
        defaultOpen: true,
        content: (
            <ChangedPathsProvider changes={panelChangedPaths}>
                <ModelHarnessSectionBody section="permissions" {...bodyProps} />
            </ChangedPathsProvider>
        ),
    }
