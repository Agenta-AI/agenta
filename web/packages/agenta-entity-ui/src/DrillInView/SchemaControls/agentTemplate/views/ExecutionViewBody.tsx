import {workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {ScrollFadeArea} from "../../../../shared/ScrollFadeArea"
import {FieldHeading} from "../accounts/FieldHeading"
import {PermissionPolicySelect} from "../PermissionPolicySelect"
import {RevertGroupButton} from "../RevertGroupButton"
import {useSandboxChoice} from "../sandboxChoice"
import {ADVANCED_PART_ICONS} from "../sections/AdvancedPartRows"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import {AdvancedPartHeader, PART_BODY_CLASS} from "./AdvancedPartHeader"
import type {AdvancedViewParams} from "./advancedViews"

/** The sandbox of the saved version, which Revert puts back. */
const committedSandboxKindOf = (parameters: unknown): string | null => {
    const sandbox = (parameters as {agent?: {sandbox?: {kind?: unknown}}} | null)?.agent?.sandbox
    return typeof sandbox?.kind === "string" ? sandbox.kind : null
}

const ExecutionViewBody = ({target}: ViewProps<AdvancedViewParams>) => {
    const t = useT(modelHarnessCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const {shownSandboxKind, sandboxKind, sandboxOptions} = useSandboxChoice(
        writer.schema,
        writer.agent,
    )
    const committedKind = committedSandboxKindOf(
        useAtomValue(workflowMolecule.selectors.serverConfiguration(writer.revisionId)),
    )
    useViewTitle(t("entityUi.modelHarness.execution"))
    const setKind = (kind: string | null) =>
        writer.update((agent) => ({
            ...agent,
            sandbox: {...((agent.sandbox as Record<string, unknown>) ?? {}), kind},
        }))
    const changed = committedKind !== null && committedKind !== sandboxKind
    const options = sandboxOptions.map((option) => ({value: option.value, title: option.label}))
    const sandboxLabel = t("entityUi.modelHarness.sandbox")

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <AdvancedPartHeader
                icon={ADVANCED_PART_ICONS.execution}
                title={t("entityUi.modelHarness.execution")}
                description={t("entityUi.modelHarness.executionCaptionShort")}
            />
            <ScrollFadeArea className={`flex min-h-0 flex-1 flex-col gap-2 ${PART_BODY_CLASS}`}>
                <div className="flex h-5 items-center justify-between gap-2">
                    <FieldHeading
                        label={sandboxLabel}
                        note={t("entityUi.modelHarness.executionCaption")}
                    />
                    {changed && !writer.readOnly ? (
                        <RevertGroupButton onConfirm={() => setKind(committedKind)} />
                    ) : null}
                </div>
                {/* Read only (a phone): the value as text, no control. */}
                {writer.readOnly ? (
                    <span className="text-label text-foreground">
                        {options.find((o) => o.value === shownSandboxKind)?.title ??
                            shownSandboxKind}
                    </span>
                ) : (
                    <PermissionPolicySelect
                        value={shownSandboxKind ?? ""}
                        onChange={(value) => setKind(value)}
                        options={options}
                        aria-label={sandboxLabel}
                        // The kit compact field, as the Default permission select of the other parts.
                        compact
                        triggerClassName="w-full gap-2"
                    />
                )}
            </ScrollFadeArea>
        </div>
    )
}

export default ExecutionViewBody
