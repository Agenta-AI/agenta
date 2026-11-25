import {useState} from "react"

import {createT, formatList, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import skillNewCatalog from "@agenta/i18n/catalogs/entityUi.skillNew"
import skillTemplateCatalog from "@agenta/i18n/catalogs/entityUi.skillTemplate"
import skillsAgentCatalog from "@agenta/i18n/catalogs/skills.agent"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Book, Compass, Plus, Trash} from "@phosphor-icons/react"

import {countSummary} from "../agentTemplateUtils"
import type {ConfigItemList} from "../ConfigItemList"
import {CreateWithAIAddMenu} from "../CreateWithAIAddMenu"
import {describeSkill, isEmbedRefSkill, skillCommandName} from "../itemDescriptors"
import {ITEM_KINDS} from "../itemKinds"
import {ItemRow} from "../ItemRow"
import {RemoveFromAgentDialog} from "../RemoveFromAgentDialog"
import {SectionAddButton} from "../SectionAddButton"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

type ConfigItemListProps = Parameters<typeof ConfigItemList>[0]

const tNow = createT(commonCatalog)

/** "Create with AI" in the "+" menu; off until the design brings it back. */
const SKILLS_CREATE_WITH_AI = false

export interface SkillsSectionParams {
    t: AgentTemplateT
    hasSkills: boolean
    fieldTitle: (field: string, fallback: string) => string
    sectionIndicator: SectionIndicatorFor
    disabled?: boolean
    skills: unknown[]
    /** "Manage": the registry list, to add or remove existing skills. */
    handleAddSkill: () => void
    /** "+": the create chooser; the new skill goes to the registry and this agent. */
    handleNewSkill: () => void
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
    handleNewSkill,
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
            <SkillsHeaderActions t={t} onManage={handleAddSkill} onNew={handleNewSkill} />
        ) : undefined,
        pageAction: !disabled ? (
            <SkillsHeaderActions page t={t} onManage={handleAddSkill} onNew={handleNewSkill} />
        ) : undefined,
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

/** The header's "Manage" (add or remove existing skills) and "+" (create one for this agent). */
const SkillsHeaderActions = ({
    t,
    onManage,
    onNew,
    page = false,
}: {
    t: AgentTemplateT
    onManage: () => void
    onNew: () => void
    /** The Configuration page: text buttons, the create one outlined. */
    page?: boolean
}) => {
    const tAgent = useT(skillsAgentCatalog)
    const tNew = useT(skillNewCatalog)
    const newLabel = tAgent("skills.agent.newSkill")
    return (
        <span className="flex items-center gap-1">
            <Button
                variant="ghost"
                size={page ? "compact" : "xs"}
                className="text-muted-foreground hover:text-foreground"
                onClick={onManage}
            >
                {tAgent("skills.agent.manage")}
            </Button>
            {page ? (
                <Button variant="outline" size="compact" onClick={onNew}>
                    <Plus size={14} aria-hidden />
                    {newLabel}
                </Button>
            ) : SKILLS_CREATE_WITH_AI ? (
                <CreateWithAIAddMenu
                    label={newLabel}
                    starterPrompt={t("entityUi.agentTemplate.skillStarter")}
                    onManual={onNew}
                    manualTitle={newLabel}
                    manualHint={tNew("entityUi.skillNew.addManuallyHint")}
                    manualIcon={<Book size={14} />}
                />
            ) : (
                <SectionAddButton label={newLabel} onClick={onNew} />
            )}
        </span>
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
    const t = useT(skillNewCatalog, skillTemplateCatalog)
    const [removing, setRemoving] = useState<{index: number; entry: unknown} | null>(null)
    const entry = removing?.entry as Record<string, unknown> | undefined
    const name = entry ? describeSkill(entry).name : ""
    const kind = ITEM_KINDS.skill
    if (skills.length === 0) {
        return disabled ? null : (
            <span className="text-meta text-muted-foreground">{kind.emptyLabel}</span>
        )
    }
    return (
        <>
            <div className="flex flex-col gap-2">
                {skills.map((skill, index) => {
                    const descriptor = kind.describe(skill)
                    const locked = disabled || kind.isReadOnly(skill)
                    const label = t("entityUi.skillTemplate.removeName", {name: descriptor.name})
                    return (
                        <ItemRow
                            key={`skill-${index}`}
                            descriptor={descriptor}
                            onEdit={() => openSkillItem("skill", index, skill)}
                            disabled={locked}
                            status={skillStatusFor?.(skill, index)}
                            extra={
                                locked ? null : (
                                    <SimpleTooltip title={label}>
                                        <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            aria-label={label}
                                            // Shown on hover or focus; always on touch, which has no hover.
                                            className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                setRemoving({index, entry: skill})
                                            }}
                                        >
                                            <Trash size={14} />
                                        </Button>
                                    </SimpleTooltip>
                                )
                            }
                        />
                    )
                })}
            </div>
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
                        if (skills[removing.index] === removing.entry) {
                            removeItem("skill", removing.index)
                            closeEditor()
                        }
                        setRemoving(null)
                    }}
                    onClose={() => setRemoving(null)}
                />
            ) : null}
        </>
    )
}
