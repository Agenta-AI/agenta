import {useChannelPanel, type UseChannelPanelOptions} from "../../src/channels/useChannelPanel"

/** A bare entry point for the panel: one row per platform that opens it there. */
export const PanelHarness = (props: UseChannelPanelOptions) => {
    const panel = useChannelPanel(props)
    return (
        <>
            {(["slack", "telegram", "whatsapp"] as const).map((platform) => (
                <button
                    key={platform}
                    type="button"
                    data-testid={`channels-row-${platform}`}
                    onClick={() => panel.open(platform)}
                >
                    {platform}
                </button>
            ))}
            {panel.panel}
        </>
    )
}
