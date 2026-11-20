import {useState} from "react"

import {useT} from "@agenta/i18n"
import agentTemplateCatalog from "@agenta/i18n/catalogs/entityUi.agentTemplate"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import skillViewCatalog from "@agenta/i18n/catalogs/entityUi.skillView"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {Button} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {UploadSimple} from "@phosphor-icons/react"

import {firstBadFile, skillFilesOf} from "../../skillFiles"
import {SkillFormView} from "../../SkillFormView"
import {skillDraftError} from "../../skillName"
import {SkillViewHeader, useSkillDownloadAction, type SkillAction} from "../../SkillViewHeader"
import {isEmbedRefSkill, isStaticSkill, staticEmbedSlug} from "../itemDescriptors"
import {useAgentConfigWriter, type AgentConfigWriter} from "../useAgentConfigWriter"

import {findSkillByKey, isAgentOnlySkillWithKey, type SkillViewParams} from "./skillView"

type Skill = Record<string, unknown>

const skillsOf = (agent: Skill): unknown[] => (Array.isArray(agent.skills) ? agent.skills : [])

/**
 * Replace the agent-only skill `key` in the agent configuration. False when it left the agent
 * while the view was open: there is nothing to write into.
 */
const replaceAgentOnlySkill = (writer: AgentConfigWriter, key: string, next: Skill): boolean => {
    let replaced = false
    writer.update((agent) => {
        const skills = skillsOf(agent)
        const index = skills.findIndex((s) => isAgentOnlySkillWithKey(s, key))
        if (index === -1) return agent
        replaced = true
        return {...agent, skills: skills.map((s, i) => (i === index ? next : s))}
    })
    return replaced
}

/** An agent-only skill: a copy is edited; Save writes it into the agent configuration. */
const AgentOnlySkillBody = ({
    skillKey,
    entry,
    writer,
    nav,
}: {
    skillKey: string
    entry: Skill
    writer: AgentConfigWriter
    nav: ViewProps<SkillViewParams>["nav"]
}) => {
    const t = useT(skillViewCatalog, configItemsCatalog, agentTemplateCatalog)
    const {skills: bridge} = useDrillInUI()
    // The skill as the view opened it. A builder save meanwhile does not reset the person's edits.
    const [original] = useState(entry)
    const [draft, setDraft] = useState(original)
    const [publishing, setPublishing] = useState(false)
    const [publishError, setPublishError] = useState<string | null>(null)
    const readOnly = writer.readOnly || isStaticSkill(entry)
    const dirty = JSON.stringify(draft) !== JSON.stringify(original)
    const invalid =
        skillDraftError(draft) !== undefined || firstBadFile(skillFilesOf(draft)) !== undefined

    useViewTitle(skillKey)
    useViewForm({
        dirty,
        valid: !readOnly && !invalid && !publishing,
        leaveDescription: t("entityUi.configItems.saveOrDiscardDraft"),
        save: async () => replaceAgentOnlySkill(writer, skillKey, draft),
    })

    const publish = async () => {
        const publishInline = bridge?.publishInlineSkill
        if (!publishInline) return
        setPublishing(true)
        setPublishError(null)
        try {
            const outcome = await publishInline(draft)
            if ("error" in outcome) {
                setPublishError(outcome.error)
                return
            }
            if (!replaceAgentOnlySkill(writer, skillKey, outcome.entry))
                setPublishError(t("entityUi.agentTemplate.publishedRowChanged"))
            // The view finds the published skill by its name; a renamed one has a new address.
            else if (draft.name !== skillKey) nav.cancel()
        } finally {
            setPublishing(false)
        }
    }

    const download = useSkillDownloadAction(draft)
    const actions: SkillAction[] = [
        ...(bridge?.publishInlineSkill && !readOnly
            ? [
                  {
                      key: "publish",
                      label: publishing
                          ? t("entityUi.agentTemplate.publishing")
                          : t("entityUi.skillView.publishToRegistry"),
                      icon: <UploadSimple size={14} className="text-muted-foreground" />,
                      onSelect: () => void publish(),
                      disabled: publishing,
                  },
              ]
            : []),
        ...download,
    ]

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <SkillViewHeader
                name={typeof draft.name === "string" && draft.name ? draft.name : skillKey}
                status={t("entityUi.skillView.agentOnlyStatus")}
                actions={actions}
                busy={publishing}
                error={publishError}
            />
            <div className="min-h-0 flex-1">
                <SkillFormView
                    value={draft}
                    onChange={readOnly ? () => undefined : setDraft}
                    baseline={original}
                    disabled={readOnly || publishing}
                    // Save is off while the draft is invalid, so there is no press to wait for: an
                    // edited draft that misses a required field says so in the fields.
                    showMissing={dirty && invalid}
                />
            </div>
        </div>
    )
}

/**
 * One skill of the agent, found by key in the list as it is now: a builder save that removes it
 * never puts another skill here. A registry skill renders the registry body of the skills bridge.
 */
const SkillViewBody = ({params, target, nav}: ViewProps<SkillViewParams>) => {
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const {skills: bridge} = useDrillInUI()
    const entry = findSkillByKey(skillsOf(writer.agent), params.item.key)
    const slug = entry && isEmbedRefSkill(entry) ? staticEmbedSlug(entry) : undefined
    const RegistryBody = bridge?.RegistrySkillBody

    if (entry && slug && RegistryBody) {
        return <RegistryBody params={{slug}} target={target} nav={nav} />
    }
    if (entry && !isEmbedRefSkill(entry)) {
        return (
            <AgentOnlySkillBody
                skillKey={params.item.key}
                entry={entry}
                writer={writer}
                nav={nav}
            />
        )
    }
    return <RemovedSkill title={params.item.key} onBack={() => void nav.back()} />
}

const RemovedSkill = ({title, onBack}: {title: string; onBack: () => void}) => {
    const t = useT(skillViewCatalog)
    useViewTitle(title)
    return (
        <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm">
            <span className="text-colorTextSecondary">{t("entityUi.skillView.removedState")}</span>
            <Button variant="outline" size="sm" onClick={onBack}>
                {t("entityUi.skillView.back")}
            </Button>
        </div>
    )
}

export default SkillViewBody
