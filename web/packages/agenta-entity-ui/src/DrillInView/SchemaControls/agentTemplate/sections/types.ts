import type {useT} from "@agenta/i18n"
import type agentTemplateCatalog from "@agenta/i18n/catalogs/entityUi.agentTemplate"
import type modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"

import type {AgentTemplateSectionDescriptor} from "../AgentTemplateSectionList"
import type {useModelHarness} from "../useModelHarness"

/** The `t` of the agent config panel (`entityUi.agentTemplate`). */
export type AgentTemplateT = ReturnType<typeof useT<[typeof agentTemplateCatalog]>>
/** The `t` of the Model, Permissions and Advanced bodies (`entityUi.modelHarness`). */
export type ModelHarnessT = ReturnType<typeof useT<[typeof modelHarnessCatalog]>>

/** The header indicator of one section, by its key (validation, draft, agent change, pulse). */
export type SectionIndicatorFor = (key: string) => AgentTemplateSectionDescriptor["indicator"]

/** What `useModelHarness` returns: the summaries, bodies and gates of its sections. */
export type ModelHarness = ReturnType<typeof useModelHarness>

/** A section descriptor, or `false` when the schema or the host leaves the section out. */
export type SectionResult = AgentTemplateSectionDescriptor | false
