import {useRef} from "react"

import {ModelSetupBanner} from "@agenta/chat/components"
import {SectionListLayoutContext} from "@agenta/entity-ui/drill-in"
import {AgentBuildPanel} from "@agenta/playground-ui/agent-build"
import {useIsPhone} from "@agenta/ui/phone"

import {useOpenModelSetup} from "../chat/useOpenModelSetup"

import {ConfigurationSectionNav} from "./ConfigurationSectionNav"
import {CONFIGURATION_PAGE_COLUMN} from "./configurationTabs"

/**
 * The Agent tab of the Configuration page: the list of the sections at the left, and the same
 * section views the right panel shows at the right. A section's item or action opens the same view
 * as in the panel (as a drawer here). On a desktop the whole tab scrolls and the list stays in
 * place; on a phone the sections are rows (M07).
 */
export const ConfigurationAgentTab = ({
    revisionId,
    readOnly,
}: {
    revisionId: string
    readOnly: boolean
}) => {
    const openModelSetup = useOpenModelSetup()
    const phone = useIsPhone()
    const scrollRef = useRef<HTMLDivElement>(null)
    return (
        <div
            ref={scrollRef}
            // The size container lets a phone section screen fill this column (its primary action
            // at the bottom).
            className="ag-scroll-no-bar min-h-0 flex-1 overflow-y-auto bg-[var(--ag-surface-raised)] max-md:bg-background max-md:[container-type:size]"
        >
            <div
                className={`${CONFIGURATION_PAGE_COLUMN} grid grid-cols-[168px_minmax(0,1fr)] items-start gap-10 pb-10 pt-7 max-md:block max-md:max-w-none max-md:p-0`}
            >
                <aside className="sticky top-7 max-md:hidden">
                    <ConfigurationSectionNav contentRef={scrollRef} />
                </aside>
                {/* On a desktop each section is its own card (A04); on a phone the sections are
                rows that run edge to edge (M07). */}
                <div
                    data-testid="configuration-agent-tab"
                    // The panel's field wrappers give the sections a 16 px inset and a white ground;
                    // the page cards sit on the page ground at the column's edges instead.
                    className={
                        phone
                            ? "min-w-0"
                            : "-mx-4 min-w-0 [&_.ag-drill-in-field-list]:bg-transparent"
                    }
                >
                    <SectionListLayoutContext.Provider value={phone ? null : "page"}>
                        <AgentBuildPanel
                            revisionId={revisionId}
                            disabled={readOnly}
                            // Automations have their own tab on this page.
                            operations={false}
                            automationDrawer={null}
                            banner={
                                // The alert keeps a gap above the rows; it collapses with the banner.
                                <div className="px-4 [&_[data-slot=alert]]:mt-3">
                                    <ModelSetupBanner
                                        revisionId={revisionId}
                                        layout="alert"
                                        onSetUp={openModelSetup}
                                    />
                                </div>
                            }
                        />
                    </SectionListLayoutContext.Provider>
                </div>
            </div>
        </div>
    )
}
