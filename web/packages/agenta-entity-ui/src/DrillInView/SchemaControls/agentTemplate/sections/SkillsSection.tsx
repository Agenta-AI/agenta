import {Compass} from "@phosphor-icons/react"

import {countSummary} from "../agentTemplateUtils"
import {ConfigItemList} from "../ConfigItemList"
import {CreateWithAIAddMenu} from "../CreateWithAIAddMenu"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

type ConfigItemListProps = Parameters<typeof ConfigItemList>[0]

export interface SkillsSectionParams {
    t: AgentTemplateT
    hasSkills: boolean
    fieldTitle: (field: string, fallback: string) => string
    sectionIndicator: SectionIndicatorFor
    disabled?: boolean
    skills: unknown[]
    handleAddSkill: () => void
    publishSkillError: string | null
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
    publishSkillError,
    openSkillItem,
    removeItem,
    closeEditor,
    skillStatusFor,
}: SkillsSectionParams): SectionResult =>
    hasSkills && {
        key: "skills",
        icon: <Compass size={16} />,
        title: fieldTitle("skills", t("entityUi.agentTemplate.skills")),
        summary: countSummary(skills.length, "skill"),
        indicator: sectionIndicator("skills"),
        extra: !disabled ? (
            <CreateWithAIAddMenu
                label={t("entityUi.agentTemplate.addSkill")}
                starterPrompt={t("entityUi.agentTemplate.skillStarter")}
                onManual={handleAddSkill}
                manualTitle={t("entityUi.agentTemplate.addManually")}
                manualHint={t("entityUi.agentTemplate.addManuallyHint")}
                manualIcon={<Compass size={16} />}
            />
        ) : undefined,
        defaultOpen: skills.length > 0,
        content: (
            <>
                {publishSkillError ? (
                    <span className="mb-2 block text-xs text-colorError">{publishSkillError}</span>
                ) : null}
                <ConfigItemList
                    kind="skill"
                    items={skills}
                    openEdit={openSkillItem}
                    removeItem={removeItem}
                    closeEditor={closeEditor}
                    disabled={disabled}
                    statusFor={skillStatusFor}
                />
            </>
        ),
    }
