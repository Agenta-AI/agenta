import {useRef} from "react"

import {ModelSetupBanner} from "@agenta/chat/components"
import {AgentBuildPanel} from "@agenta/playground-ui/agent-build"

import {useOpenModelSetup} from "../chat/useOpenModelSetup"

import {ConfigurationSectionNav} from "./ConfigurationSectionNav"

/**
 * The Agent tab of the Configuration page: the list of the sections at the left, and the same
 * section views the right panel shows at the right. A section's item or action opens the same view
 * as in the panel (as a drawer here).
 */
export const ConfigurationAgentTab = ({
    revisionId,
    readOnly,
}: {
    revisionId: string
    readOnly: boolean
}) => {
    const openModelSetup = useOpenModelSetup()
    const contentRef = useRef<HTMLDivElement>(null)
    return (
        <div className="flex min-h-0 flex-1 gap-6">
            <aside className="w-44 shrink-0 max-md:hidden">
                <ConfigurationSectionNav contentRef={contentRef} />
            </aside>
            <div
                ref={contentRef}
                data-testid="configuration-agent-tab"
                className="ag-scroll-no-bar min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer"
            >
                <AgentBuildPanel
                    revisionId={revisionId}
                    disabled={readOnly}
                    // Automations have their own tab on this page.
                    operations={false}
                    automationDrawer={null}
                    banner={
                        <div className="px-4 pt-3">
                            <ModelSetupBanner
                                revisionId={revisionId}
                                layout="alert"
                                onSetUp={openModelSetup}
                            />
                        </div>
                    }
                />
            </div>
        </div>
    )
}
