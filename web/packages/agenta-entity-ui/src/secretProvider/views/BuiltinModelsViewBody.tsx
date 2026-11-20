/**
 * The "Agenta" card (F09 f1c): the built-in models. The key is Agenta's, so the field is locked
 * and there is no name. The models have no switches: turning a built-in model off per project
 * is not part of this work. Done only; nothing is stored.
 */
import {useMemo} from "react"

import {builtinModelsOf} from "@agenta/entities/secret"
import {
    agentModelCandidatesAtomFamily,
    builtinModelEndpointsQueryAtom,
} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import providerConnectionCatalog from "@agenta/i18n/catalogs/entityUi.providerConnection"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {modelDisplayName} from "../../DrillInView/SchemaControls/connectionUtils"
import {harnessMetaFor} from "../../DrillInView/SchemaControls/harnessMeta"
import {harnessMarkNode} from "../harnessMark"

import type {BuiltinModelsViewParams} from "./providerViews"

const BuiltinModelsViewBody = (_props: ViewProps<BuiltinModelsViewParams>) => {
    const t = useT(providerListCatalog, providerConnectionCatalog, settingsProvidersCatalog)
    useViewTitle(t("entityUi.providerList.agenta"))
    const models = builtinModelsOf(useAtomValue(builtinModelEndpointsQueryAtom).data)
    const {candidates, capabilities} = useAtomValue(agentModelCandidatesAtomFamily(false))
    // The harnesses that can run the built-in models, in the order the candidates offer them.
    const harnesses = useMemo(
        () => [
            ...new Set(
                candidates
                    .filter((candidate) => candidate.namespace === "builtin")
                    .map((candidate) => candidate.harness),
            ),
        ],
        [candidates],
    )

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
            <section className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-colorText">
                    {t("settings.providers.apiKey")}
                </span>
                <div
                    aria-readonly
                    className="rounded-control-sm border border-solid border-colorBorder bg-colorFillQuaternary px-3 py-1.5 text-sm text-colorTextSecondary"
                >
                    {t("entityUi.providerList.providedByAgenta")}
                </div>
            </section>
            <section className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-colorText">
                    {t("entityUi.providerConnection.activeModels")}
                </span>
                <ul className="m-0 flex list-none flex-col rounded-control-sm border border-solid border-colorBorderSecondary p-0">
                    {models.map((model) => {
                        const name = modelDisplayName(capabilities, harnesses[0], model)
                        return (
                            <li
                                key={model}
                                className="flex flex-col border-0 border-b border-solid border-colorBorderSecondary px-3 py-2 last:border-b-0"
                            >
                                <span className="text-sm text-colorText">{name}</span>
                                {name !== model ? (
                                    <span className="font-mono text-xs text-colorTextTertiary">
                                        {model}
                                    </span>
                                ) : null}
                            </li>
                        )
                    })}
                </ul>
            </section>
            {harnesses.length ? (
                <section className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-colorText">
                        {t("entityUi.providerConnection.harnesses")}
                    </span>
                    <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
                        {harnesses.map((harness) => (
                            <li
                                key={harness}
                                className="flex items-center gap-1.5 text-sm text-colorTextSecondary"
                            >
                                {harnessMarkNode(harness, "size-3.5 shrink-0")}
                                {harnessMetaFor(harness).label}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    )
}

export default BuiltinModelsViewBody
