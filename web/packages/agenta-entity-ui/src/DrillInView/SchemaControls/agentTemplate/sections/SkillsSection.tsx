import {useState} from "react"

import {createT, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import skillNewCatalog from "@agenta/i18n/catalogs/entityUi.skillNew"
import {Compass} from "@phosphor-icons/react"

import {countSummary} from "../agentTemplateUtils"
import {ConfigItemList} from "../ConfigItemList"
import {CreateWithAIAddMenu} from "../CreateWithAIAddMenu"
import {describeSkill, isEmbedRefSkill, skillCommandName} from "../itemDescriptors"
import {RemoveFromAgentDialog} from "../RemoveFromAgentDialog"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

type ConfigItemListProps = Parameters<typeof ConfigItemList>[0]

const tNow = createT(commonCatalog)

export interface SkillsSectionParams {
    t: AgentTemplateT
    hasSkills: boolean
    fieldTitle: (field: string, fallback: string) => string
    sectionIndicator: SectionIndicatorFor
    disabled?: boolean
    skills: unknown[]
    handleAddSkill: () => void
    openSkillItem: ConfigItemListProps["openEdit"]
    removeItem: ConfigItemListProps["removeItem"]
    closeEditor: () => void
    skillStatusFor: ConfigItemListProps["statusFor"]
}

/** The agent's skills: inline SKILL.md packages and `@ag.embed` references. */
export const skillsSection = ({
    t,
    hasSkills,
    fieldTitle,
    sectionIndicator,
    disabled,
    skills,
    handleAddSkill,
    openSkillItem,
    removeItem,
    closeEditor,
    skillStatusFor,
}: SkillsSectionParams): SectionResult =>
    hasSkills && {
        key: "skills",
        icon: <Compass size={16} />,
        title: fieldTitle("skills", t("entityUi.agentTemplate.skills")),
        // "None" when empty, as the canvas draws the Agent tab.
        summary: countSummary(skills.length, "skill") || tNow("common.none"),
        phoneSummary:
            skills
                .map((skill) => skillCommandName(skill) ?? describeSkill(skill).name)
                .join(", ") || tNow("common.none"),
        indicator: sectionIndicator("skills"),
        extra: !disabled ? <SkillsAddMenu t={t} onManual={handleAddSkill} /> : undefined,
        defaultOpen: skills.length > 0,
        content: (
            <SkillsList
                skills={skills}
                openSkillItem={openSkillItem}
                removeItem={removeItem}
                closeEditor={closeEditor}
                disabled={disabled}
                skillStatusFor={skillStatusFor}
            />
        ),
    }

/** "+" (F04 f1): "Create with AI" and "Add manually". */
const SkillsAddMenu = ({t, onManual}: {t: AgentTemplateT; onManual: () => void}) => {
    const tNew = useT(skillNewCatalog)
    return (
        <CreateWithAIAddMenu
            label={t("entityUi.agentTemplate.addSkill")}
            starterPrompt={t("entityUi.agentTemplate.skillStarter")}
            onManual={onManual}
            manualTitle={t("entityUi.agentTemplate.addManually")}
            manualHint={tNew("entityUi.skillNew.addManuallyHint")}
            manualIcon={<Compass size={16} />}
        />
    )
}

/** The skill rows; a row's bin asks first (F06 f2). */
const SkillsList = ({
    skills,
    openSkillItem,
    removeItem,
    closeEditor,
    disabled,
    skillStatusFor,
}: Pick<
    SkillsSectionParams,
    "skills" | "openSkillItem" | "removeItem" | "closeEditor" | "disabled" | "skillStatusFor"
>) => {
    const t = useT(skillNewCatalog)
    const [removing, setRemoving] = useState<{index: number; entry: unknown} | null>(null)
    const entry = removing?.entry as Record<string, unknown> | undefined
    const name = typeof entry?.name === "string" && entry.name ? entry.name : ""
    return (
        <>
            <ConfigItemList
                kind="skill"
                items={skills}
                openEdit={openSkillItem}
                removeItem={(_kind, index) => setRemoving({index, entry: skills[index]})}
                closeEditor={closeEditor}
                disabled={disabled}
                statusFor={skillStatusFor}
            />
            {removing ? (
                <RemoveFromAgentDialog
                    open
                    name={name}
                    description={
                        isEmbedRefSkill(entry)
                            ? t("entityUi.skillNew.removeRegistryBody")
                            : t("entityUi.skillNew.removeAgentOnlyBody")
                    }
                    onRemove={() => {
                        // The list may have changed under the dialog: remove the same entry only.
                        if (skills[removing.index] === removing.entry)
                            removeItem("skill", removing.index)
                        setRemoving(null)
                    }}
                    onClose={() => setRemoving(null)}
                />
            ) : null}
        </>
    )
}
