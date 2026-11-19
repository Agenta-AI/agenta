import {createT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import itemDescriptorsCatalog from "@agenta/i18n/catalogs/entityUi.itemDescriptors"
import {Compass} from "@phosphor-icons/react"

import {SkillFormView} from "../../SkillFormView"
import {skillDraftError} from "../../skillName"
import {describeSkill, isEmbedRefSkill, isStaticSkill} from "../itemDescriptors"

import type {ItemFormView, ItemKindDef} from "./types"

const t = createT(configItemsCatalog, itemDescriptorsCatalog)

/** Inline skills are saved config, so the playground drawer offers them as a download. */
const DownloadableSkillFormView: ItemFormView = (props) => <SkillFormView {...props} downloadable />

export const skillKind: ItemKindDef = {
    kind: "skill",
    field: "skills",
    icon: <Compass size={16} />,
    noun: "skill",
    get emptyLabel() {
        return t("entityUi.configItems.noSkillsYet")
    },
    describe: describeSkill,
    FormView: DownloadableSkillFormView,
    // Wider than the default 600 — the skill drawer is two-pane (Files + editor).
    drawerWidth: () => 760,
    drawerTitle: (draft) =>
        isEmbedRefSkill(draft)
            ? t("entityUi.itemDescriptors.skillReference")
            : String(draft.name ?? "").trim() || t("entityUi.configItems.newSkill"),
    jsonOnly: (draft) => isEmbedRefSkill(draft),
    isReadOnly: (item) => isStaticSkill(item),
    createSeed: () => ({name: "", description: "", body: ""}),
    // `@ag.embed` references round-trip as-is; everything else must pass the SDK's own rules.
    draftInvalid: (draft) => !isEmbedRefSkill(draft) && skillDraftError(draft) !== undefined,
}
