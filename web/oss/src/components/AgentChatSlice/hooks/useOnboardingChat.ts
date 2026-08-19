import {type RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {generateId} from "@agenta/shared/utils"
import {type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {type UIMessage} from "ai"
import {useAtomValue} from "jotai"

import {
    IDE_INSTALL_COMMAND,
    TEMPLATE_STRIP_MODE,
} from "@/oss/components/pages/agent-home/assets/constants"
import {
    captureFirstAgentIntent,
    classifyAgentIntent,
    truncateForCapture,
} from "@/oss/components/pages/agent-home/assets/onboardingAnalytics"
import {type AgentTemplate} from "@/oss/components/pages/agent-home/assets/templates"
import {useOptionalOnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"
import {useTemplateProvenance} from "@/oss/components/TemplateStrip/hooks/useTemplateProvenance"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {type ScrollIntent} from "./useScrollIntent"

/**
 * Playground-native onboarding. This chat panel IS the onboarding surface while the agent is
 * ephemeral: the empty state shows the "what do you want to build?" hero and the composer renders
 * Create-agent / Continue-in-IDE controls (submit = commit the ephemeral in place, not send). Read
 * from the OnboardingContext, present ONLY inside the onboarding playground — every value here is
 * inert (`onboardingActive: false`) elsewhere, so other chat usages are unchanged.
 */
export const useOnboardingChat = ({
    entityId,
    richInputRef,
    messages,
    setMessages,
    setStopped,
    intent,
}: {
    entityId: string
    richInputRef: RefObject<RichChatInputHandle | null>
    messages: UIMessage[]
    setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void
    setStopped: (stopped: boolean) => void
    intent: ScrollIntent
}) => {
    const onboarding = useOptionalOnboardingContext()
    const onboardingActive = !!onboarding && !onboarding.realEntityId
    // Post-commit chrome (the connect-model banner) stays hidden through the commit + first send, then
    // eases in a beat later (see `chromeRevealed`) so it doesn't move the composer during the send.
    const chromeHidden = !!onboarding && !onboarding.chromeRevealed
    const onboardingPosthog = usePostHogAg()

    // ── Template strip (TEMPLATE_STRIP_MODE) ─────────────────────────────────
    // One provenance instance per panel, shared by the onboarding hero strip (S5) and the
    // agent empty-chat strip (S6): pick fills the composer + docks the chip above it.
    const stripProvenance = useTemplateProvenance({
        composerApi: {
            setText: (text) => richInputRef.current?.setMarkdown(text),
            getText: () => richInputRef.current?.getMarkdown() ?? "",
        },
    })
    // Provenance is scoped to ONE agent revision. `AgentConversation` survives an `entityId`
    // change in place (see the self-commit `switchEntity` and a revision swap) — without
    // this, a template picked against the old entity would leak its name into the new one. Drop
    // only the chip, not the composer text: a commit must not wipe the user's in-progress draft (#5246).
    useEffect(() => {
        stripProvenance.clearProvenance()
    }, [entityId, stripProvenance.clearProvenance])
    // S6 gate: fresh agent only (`version` v0/v1 = creation, same seed-vs-history convention used
    // elsewhere); unknown while loading counts as not-fresh so the strip never flashes in.
    const revisionQuery = useAtomValue(workflowMolecule.selectors.query(entityId))
    const revisionVersion = revisionQuery.data?.version
    const isFreshAgentRevision =
        !revisionQuery.isPending && typeof revisionVersion === "number" && revisionVersion <= 1
    const handleStripPick = useCallback(
        (template: AgentTemplate) => {
            stripProvenance.pick(template)
            captureFirstAgentIntent(onboardingPosthog, {
                source: "template",
                properties: {
                    template: template.name,
                    templateId: template.key,
                    templateCategory: template.category,
                    mode: "strip",
                    surface: onboardingActive ? "onboarding" : "agent-chat",
                },
                intentValue: template.category || template.name,
            })
        },
        [stripProvenance.pick, onboardingPosthog, onboardingActive],
    )

    // Optimistic first turn: the description the user submitted with "Create agent", shown as a sent
    // user message + assistant loading placeholder DURING commit + until the real conversation takes
    // over — so the onboarding hero never flashes back and the switch reads as one continuous chat.
    const [pendingFirstTurn, setPendingFirstTurn] = useState<string | null>(null)

    const handleCreateAgent = useCallback(() => {
        if (!onboarding || onboarding.committing) return
        const text = richInputRef.current?.getMarkdown().trim() ?? ""
        // Resolve BEFORE clearing the composer below — `resolveTemplateName` compares against the
        // live text, so reading it after the clear would always see "" and never match the seed.
        const templateName = stripProvenance.resolveTemplateName(text)
        setPendingFirstTurn(text || null)
        // The text becomes the sent first turn — clear the composer so it doesn't linger into the chat.
        richInputRef.current?.setMarkdown("")
        // Free-text submit (never a template — those go straight through `onboarding.commit` from the
        // template pickers below, source "template"), so no double-fire with those call sites.
        if (text) {
            captureFirstAgentIntent(onboardingPosthog, {
                source: "composer",
                properties: {message: truncateForCapture(text)},
                intentValue: classifyAgentIntent(text),
            })
        }
        onboarding.commit(text, templateName)
        if (TEMPLATE_STRIP_MODE) stripProvenance.clear()
    }, [onboarding, onboardingPosthog, stripProvenance.clear, stripProvenance.resolveTemplateName])

    // Also cover the template-click commit path (which goes straight through `commit()`, not the
    // Create button): whenever a commit is in flight, show its seed as the optimistic turn and clear
    // any lingering composer text (e.g. a "Try" chip the user had prefilled).
    useEffect(() => {
        if (onboarding?.committing && onboarding.committingSeed) {
            setPendingFirstTurn(onboarding.committingSeed)
            richInputRef.current?.setMarkdown("")
        }
    }, [onboarding?.committing, onboarding?.committingSeed])

    // Once the real conversation has a message (auto-send fired post-commit), the placeholder handed
    // off — drop it so the real turn owns the view.
    useEffect(() => {
        if (messages.length > 0 && pendingFirstTurn) setPendingFirstTurn(null)
    }, [messages.length, pendingFirstTurn])

    // Commit failed (committing went true→false without producing a real agent): restore the hero so
    // the user can retry, rather than stranding the placeholder with an eternal spinner.
    const sawCommittingRef = useRef(false)
    useEffect(() => {
        if (onboarding?.committing) {
            sawCommittingRef.current = true
        } else if (sawCommittingRef.current && !onboarding?.realEntityId && messages.length === 0) {
            sawCommittingRef.current = false
            setPendingFirstTurn(null)
        }
    }, [onboarding?.committing, onboarding?.realEntityId, messages.length])

    const pendingFirstMessage = useMemo<UIMessage>(
        () => ({
            id: "pending-first-turn",
            role: "user",
            parts: [{type: "text", text: pendingFirstTurn ?? ""}],
        }),
        [pendingFirstTurn],
    )

    // "Continue in IDE" — the user's prompt lands as a real user turn, and a streamed-looking assistant
    // bubble hands off the install command + prompt (a pseudo response; there's no agent to run
    // pre-commit). Two clear steps: install the skill, then give the coding agent the prompt — the prompt
    // is NOT inside the shell block (it's not a command). Clears the composer so the text isn't duplicated.
    // Holds the pending IDE-bubble typewriter timer so it can be cancelled on unmount (tab close,
    // rewind, route change) — otherwise the recursive chain keeps calling setMessages on a stale closure.
    const ideBubbleTimerRef = useRef<number | null>(null)
    // The ref holds ONE handle, so anything that starts (or invalidates) a chain must cancel the
    // previous one first — overwriting the handle would strand the old chain beyond every cleanup.
    const cancelIdeBubble = useCallback(() => {
        if (ideBubbleTimerRef.current) window.clearTimeout(ideBubbleTimerRef.current)
        ideBubbleTimerRef.current = null
    }, [])
    const streamIdeBubble = useCallback(() => {
        cancelIdeBubble()
        const prompt = richInputRef.current?.getMarkdown().trim() ?? ""
        const promptQuote = prompt
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")
        const full = prompt
            ? `Prefer to build in your IDE? Install the Agenta skill for Claude Code, Cursor, or any coding agent:\n\n\`\`\`bash\n${IDE_INSTALL_COMMAND}\n\`\`\`\n\nThen hand it your prompt:\n\n${promptQuote}`
            : `Prefer to build in your IDE? Install the Agenta skill for Claude Code, Cursor, or any coding agent:\n\n\`\`\`bash\n${IDE_INSTALL_COMMAND}\n\`\`\`\n\nThen describe the agent you want it to build.`
        const id = `ide-${generateId()}`
        const userId = `ide-user-${generateId()}`
        intent.armGlide()
        setStopped(false)
        // Clear the composer — the prompt is now the sent user turn (and the editor is disabled after this).
        richInputRef.current?.setMarkdown("")
        setMessages(
            (prev) =>
                [
                    ...prev,
                    ...(prompt
                        ? [{id: userId, role: "user", parts: [{type: "text", text: prompt}]}]
                        : []),
                    {id, role: "assistant", parts: [{type: "text", text: ""}]},
                ] as typeof prev,
        )
        let shown = 0
        const chunk = Math.max(3, Math.ceil(full.length / 36))
        const tick = () => {
            shown = Math.min(full.length, shown + chunk)
            const text = full.slice(0, shown)
            setMessages(
                (prev) =>
                    prev.map((m) =>
                        m.id === id ? {...m, parts: [{type: "text", text}]} : m,
                    ) as typeof prev,
            )
            if (shown < full.length) ideBubbleTimerRef.current = window.setTimeout(tick, 28)
        }
        ideBubbleTimerRef.current = window.setTimeout(tick, 120)
    }, [setMessages, cancelIdeBubble])

    // Cancel any in-flight IDE-bubble animation on unmount so its timer chain can't fire post-unmount.
    useEffect(() => cancelIdeBubble, [cancelIdeBubble])

    // After an IDE hand-off (onboarding + messages exist but nothing was committed), the chat is a
    // dead-end — there's no agent to talk to. Disable the composer and offer a single "Start over".
    const ideHandoffActive = onboardingActive && messages.length > 0
    const handleStartOver = useCallback(() => {
        // Start over wipes the transcript the chain is typing into — stop it, or it keeps ticking
        // against messages that no longer exist (and outlives the next chain's handle).
        cancelIdeBubble()
        setMessages(() => [])
        richInputRef.current?.setMarkdown("")
    }, [setMessages, cancelIdeBubble])

    // Strip era (TEMPLATE_STRIP_MODE): the bare "what do you want to build?" hero (no messages yet,
    // nothing pending, not browsing the template gallery) is when the onboarding TemplateStrip docks
    // directly above the composer, mirroring the agent-chat strip's bottom-anchored rhythm.
    const showBareOnboardingHero =
        TEMPLATE_STRIP_MODE &&
        onboardingActive &&
        messages.length === 0 &&
        !pendingFirstTurn &&
        !onboarding?.browseAll

    /** Sending consumes the template provenance along with the composer text. */
    const consumeTemplateProvenance = useCallback(() => {
        if (TEMPLATE_STRIP_MODE) stripProvenance.clear()
    }, [stripProvenance.clear])

    return {
        onboarding,
        onboardingActive,
        chromeHidden,
        selectedTemplateKey: stripProvenance.selectedTemplateKey,
        handleStripPick,
        isFreshAgentRevision,
        pendingFirstTurn,
        pendingFirstMessage,
        handleCreateAgent,
        streamIdeBubble,
        ideHandoffActive,
        handleStartOver,
        showBareOnboardingHero,
        consumeTemplateProvenance,
    }
}
