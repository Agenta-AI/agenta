import {ChannelsPage} from "@agenta/settings-ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"

/**
 * OSS binding: the shared Channels page with this app's drawer as the sliding panel.
 *
 * FIRST PASS: `ChannelsPage` holds its connections in local state (no data layer yet), so the
 * agent name and connections here are placeholders for visual review. Wire `agentName`,
 * `workspaceName`, and `initialConnections` to real data — and lift the page's state to
 * atoms/mutations — when the backend lands.
 */
const Channels = () => (
    <ChannelsPage
        agentName="your agent"
        renderPanel={({open, title, subtitle, onClose, children}) => (
            <EnhancedDrawer
                open={open}
                onClose={onClose}
                width={600}
                title={
                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-colorText">{title}</span>
                        {subtitle ? (
                            <span className="text-xs text-colorTextTertiary">{subtitle}</span>
                        ) : null}
                    </div>
                }
            >
                <div className="px-6 py-5">{children}</div>
            </EnhancedDrawer>
        )}
    />
)

export default Channels
