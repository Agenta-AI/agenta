import React from "react"

export interface TraceTreeSettingsProps {
    settings: {latency: boolean; cost: boolean; tokens: boolean}
    setSettings: React.Dispatch<
        React.SetStateAction<{latency: boolean; cost: boolean; tokens: boolean}>
    >
}
