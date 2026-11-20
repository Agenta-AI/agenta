/**
 * The model providers views (F09 f1 to f3), all with the target `project`. The bodies load on
 * first open.
 *
 * - `providerListView`: the list. A picker: it writes nothing and opens the other views.
 * - `providerAddView`: "Add a provider or subscription". A picker: a picked provider replaces it
 *   with its form, at the same depth (`nav.replace`), so Save goes back to the list.
 * - `providerConnectionView`: one connection's form. Save writes the project's connection.
 * - `builtinModelsView`: the "Agenta" card. Read only, with Done.
 *
 * Names: the screen is "Model providers" (view ids `project.modelProviders.*`); the code calls
 * its parts `provider*`, and their text lives in the `entityUi.providerList` namespace.
 */
import {defineView} from "@agenta/ui/view-stack"

import {lazyView} from "../../DrillInView/SchemaControls/agentTemplate/views/lazyView"

export type ProviderListViewParams = Record<string, never>
export type ProviderAddViewParams = Record<string, never>
export interface ProviderConnectionViewParams {
    /** The provider kind of the form (`openai`, `azure`, …). */
    kind: string
    /** The saved connection to edit. Absent for a new connection. */
    connectionId?: string
}
export type BuiltinModelsViewParams = Record<string, never>

export const providerListView = defineView<ProviderListViewParams>({
    id: "project.modelProviders",
    apply: "immediate",
    // The list carries "Add a provider or subscription" at the bottom; no Done row (F09 f1, M12).
    actions: "none",
    Component: lazyView(() => import("./ProviderListViewBody")),
})

export const providerAddView = defineView<ProviderAddViewParams>({
    id: "project.modelProviders.add",
    apply: "immediate",
    Component: lazyView(() => import("./ProviderAddViewBody")),
})

export const providerConnectionView = defineView<ProviderConnectionViewParams>({
    id: "project.modelProviders.connection",
    apply: "on_save",
    Component: lazyView(() => import("./ProviderConnectionViewBody")),
})

export const builtinModelsView = defineView<BuiltinModelsViewParams>({
    id: "project.modelProviders.builtin",
    apply: "immediate",
    Component: lazyView(() => import("./BuiltinModelsViewBody")),
})
