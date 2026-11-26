import {useState} from "react"

import {createT, formatList, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import skillNewCatalog from "@agenta/i18n/catalogs/entityUi.skillNew"
import {Compass, Plus} from "@phosphor-icons/react"

import {countSummary} from "../agentTemplateUtils"
import type {ConfigItemList} from "../ConfigItemList"
import {describeSkill, isEmbedRefSkill, skillCommandName} from "../itemDescriptors"
import {ITEM_KINDS} from "../itemKinds"
import {ItemRow} from "../ItemRow"
import {SectionAddButton} from "../SectionAddButton"
import {SectionEmpty} from "../SectionEmpty"
import {SectionPageAction} from "../SectionPageAction"
import {RemoveFromAgentDialog} from "../views/RemoveFromAgentDialog"

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
    /** "+": "Add skills", the list that adds, removes and creates ("New skill") skills. */
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
        icon: <Compass size={14} />,
        title: fieldTitle("skills", t("entityUi.agentTemplate.skills")),
        // "None" when empty, as the canvas draws the Agent tab.
        summary: countSummary(skills.length, "skill") || tNow("common.none"),
        empty: skills.length === 0,
        phoneSummary:
            formatList(
                skills.map((skill) => skillCommandName(skill) ?? describeSkill(skill).name),
            ) || tNow("common.none"),
        indicator: sectionIndicator("skills"),
        extra: !disabled ? (
            <SectionAddButton
                label={t("entityUi.agentTemplate.addSkill")}
                onClick={handleAddSkill}
            />
        ) : undefined,
        emptyAction: !disabled
            ? {label: t("entityUi.agentTemplate.addSkill"), onClick: handleAddSkill}
            : undefined,
        pageAction: !disabled ? (
            <SectionPageAction action="add" onClick={handleAddSkill} />
        ) : undefined,
        phoneAction: !disabled
            ? {
                  label: t("entityUi.agentTemplate.addSkill"),
                  icon: <Plus className="size-3.5" />,
                  onClick: handleAddSkill,
              }
            : undefined,
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
    const kind = ITEM_KINDS.skill
    if (skills.length === 0) {
        return disabled ? null : <SectionEmpty>{kind.emptyLabel}</SectionEmpty>
    }
    return (
        <>
            <div className="flex flex-col gap-2">
                {skills.map((skill, index) => {
                    const locked = disabled || kind.isReadOnly(skill)
                    return (
                        <ItemRow
                            key={`skill-${index}`}
                            descriptor={kind.describe(skill)}
                            onEdit={() => openSkillItem("skill", index, skill)}
                            onRemove={() => setRemoving({index, entry: skill})}
                            disabled={locked}
                            status={skillStatusFor?.(skill, index)}
                        />
                    )
                })}
            </div>
            <RemoveFromAgentDialog
                open={removing !== null}
                name={entry ? describeSkill(entry).name : ""}
                body={
                    isEmbedRefSkill(entry)
                        ? t("entityUi.skillNew.removeRegistryBody")
                        : t("entityUi.skillNew.removeAgentOnlyBody")
                }
                onCancel={() => setRemoving(null)}
                onConfirm={() => {
                    // The list may have changed: remove the same entry only.
                    if (removing && skills[removing.index] === removing.entry) {
                        removeItem("skill", removing.index)
                        closeEditor()
                    }
                    setRemoving(null)
                }}
            />
        </>
    )
}
