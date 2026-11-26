import type {PhoneSection} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import agentPagesPhoneCatalog from "@agenta/i18n/catalogs/agentPages.phone"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {PhoneScreenHeader} from "@agenta/ui/phone"
import {Button, SimpleTooltip} from "@agenta/ui/ui"

import {AgentConfigTabs} from "./AgentConfigTabs"
import {useAgentPanel} from "./agentPanelContext"
import type {ConfigTab} from "./agentPanelState"
import type {PaneBack} from "./paneBack"

const TABS: {key: ConfigTab; label: "agent" | "automations" | "channels" | "access"}[] = [
    {key: "agent", label: "agent"},
    {key: "automations", label: "automations"},
    {key: "channels", label: "channels"},
    {key: "access", label: "access"},
]

// Channels is a page of its own on a phone (the agent sidebar opens it).
const PHONE_TABS = TABS.filter((tab) => tab.key !== "channels")

/**
 * The Configuration content's header: the tab row in the pane header, or on a phone the back
 * arrow to the session over the tabs. Light, so the content's loading state draws it too.
 */
export const ConfigurationHeader = ({
    configTab,
    onSelectTab,
    paneBack = null,
    phoneSection = null,
    onCloseSection,
}: {
    configTab: ConfigTab
    onSelectTab: (tab: ConfigTab) => void
    /** A view open inside a tab puts its back link in the header. */
    paneBack?: PaneBack | null
    /** On a phone, the section shown as its own screen. */
    phoneSection?: PhoneSection | null
    onCloseSection?: () => void
}) => {
    const t = useT(agentLayoutPanelCatalog, agentLayoutHeaderCatalog, agentPagesPhoneCatalog)
    const panel = useAgentPanel()
    const tabs = panel.phone ? PHONE_TABS : TABS
    const tabRow = (back: PaneBack | null, onClose?: () => void) => (
        <AgentConfigTabs
            tabs={tabs.map((tab) => ({key: tab.key, label: t(`agentLayout.panel.${tab.label}`)}))}
            value={configTab}
            onSelect={onSelectTab}
            phone={panel.phone}
            back={back}
            onClose={onClose}
        />
    )
    if (!panel.phone)
        // The pane header: the session bar's 48 px, the tab text on the pane's 16 px line.
        return tabRow(paneBack, () => void panel.close())
    if (phoneSection)
        return (
            <PhoneScreenHeader
                title={phoneSection.title}
                backTitle={t("agentLayout.header.configuration")}
                onBack={() => onCloseSection?.()}
            />
        )
    return (
        <>
            <PhoneScreenHeader
                title={t("agentLayout.header.configuration")}
                hideTitle
                backTitle={t("agentPages.phone.session")}
                onBack={() => void panel.close()}
                trailing={
                    panel.available.builder ? (
                        <SimpleTooltip title={t("agentLayout.header.builder")}>
                            <Button
                                variant="ghost"
                                size="icon-compact"
                                aria-label={t("agentLayout.header.builder")}
                                onClick={() => void panel.toggle("builder")}
                            >
                                <BuilderIcon />
                            </Button>
                        </SimpleTooltip>
                    ) : null
                }
            />
            {/* The tabs; History lives in the More sheet on a phone. */}
            {tabRow(null)}
        </>
    )
}
