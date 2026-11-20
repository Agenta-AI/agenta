import {createT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import {Shield} from "@phosphor-icons/react"

import {ChangedPathsProvider, type ChangedPaths} from "../../../../drawers/shared"
import {SectionPageRow} from "../SectionPageRow"

import {ModelHarnessSectionBody, type ModelHarnessBodyProps} from "./ModelHarnessSectionBody"
import type {AgentTemplateT, ModelHarness, SectionIndicatorFor, SectionResult} from "./types"

const tNow = createT(modelHarnessCatalog, configItemsCatalog)

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
        // On the page: one row with the policy select at the right (canvas A04).
        pageContent: (
            <SectionPageRow
                icon={<Shield size={16} />}
                title={tNow("entityUi.modelHarness.policy")}
                summary={tNow("entityUi.configItems.policyHint")}
                trailing={<span className="flex w-40">{policy}</span>}
            />
        ),
    }
}
