import {workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {RailField} from "../../../../drawers/shared/RailField"
import {EnumSelectControl} from "../../EnumSelectControl"
import {RevertGroupButton} from "../RevertGroupButton"
import {useSandboxChoice} from "../sandboxChoice"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {AdvancedViewParams} from "./advancedViews"

/** The sandbox of the saved version, which Revert puts back. */
const committedSandboxKindOf = (parameters: unknown): string | null => {
    const sandbox = (parameters as {agent?: {sandbox?: {kind?: unknown}}} | null)?.agent?.sandbox
    return typeof sandbox?.kind === "string" ? sandbox.kind : null
}

const ExecutionViewBody = ({target}: ViewProps<AdvancedViewParams>) => {
    const t = useT(modelHarnessCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const {sandboxProps, sandboxKind, shownSandboxKind, sandboxOptions} = useSandboxChoice(
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

    return (
        <div className="flex flex-col gap-4 px-4 py-3">
            <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-xs leading-snug text-colorTextDescription">
                    {t("entityUi.modelHarness.executionCaption")}
                </span>
                {changed && !writer.readOnly ? (
                    <RevertGroupButton onConfirm={() => setKind(committedKind)} />
                ) : null}
            </div>
            <RailField
                label={t("entityUi.modelHarness.sandbox")}
                align="center"
                path="sandbox.kind"
            >
                <EnumSelectControl
                    schema={sandboxProps.kind}
                    options={sandboxOptions}
                    value={shownSandboxKind}
                    onChange={(value) => setKind(value as string | null)}
                    disabled={writer.readOnly}
                />
            </RailField>
        </div>
    )
}

export default ExecutionViewBody
