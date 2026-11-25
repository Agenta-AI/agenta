/**
 * The Advanced section: the body it shows inline while the sandbox has a
 * change that is not saved yet (the config panel narrows to what changed). The parts themselves
 * open as views (`views/advancedView`).
 */
import type {SchemaProperty} from "@agenta/entities/shared"

import {RailField} from "../../../../drawers/shared/RailField"
import {EnumSelectControl, type getEnumOptions} from "../../EnumSelectControl"

import type {ModelHarnessT} from "./types"

export interface AdvancedSectionBodyParams {
    t: ModelHarnessT
    disabled?: boolean
    withTooltip?: boolean
    hasExecutionGroup: boolean
    sandboxProps: Record<string, SchemaProperty>
    sandboxOptions: ReturnType<typeof getEnumOptions>
    shownSandboxKind: string | null
    setSection: (key: string, sectionValue: unknown) => void
    sandbox: Record<string, unknown>
}

export const useAdvancedSectionBody = ({
    t,
    disabled,
    withTooltip,
    hasExecutionGroup,
    sandboxProps,
    sandboxOptions,
    shownSandboxKind,
    setSection,
    sandbox,
}: AdvancedSectionBodyParams) => {
    const advancedChangeBody = hasExecutionGroup ? (
        <div className="flex flex-col gap-3">
            <RailField
                label={t("entityUi.modelHarness.sandbox")}
                align="center"
                path="sandbox.kind"
            >
                <EnumSelectControl
                    schema={sandboxProps.kind}
                    options={sandboxOptions}
                    value={shownSandboxKind}
                    onChange={(v) => setSection("sandbox", {...sandbox, kind: v})}
                    withTooltip={withTooltip}
                    disabled={disabled}
                />
            </RailField>
        </div>
    ) : null

    return {advancedChangeBody}
}
