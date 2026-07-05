import {memo} from "react"

import {Tabs, TabsList, TabsTrigger} from "@agenta/primitive-ui/components/tabs"

import {TAB_ITEMS} from "./assets/constants"
import type {SessionHeaderRightProps} from "./assets/type"

const SessionHeaderRight = memo(function SessionHeaderRight({
    activeView,
    onTabChange,
}: SessionHeaderRightProps) {
    return (
        <div className="flex items-center gap-4">
            <Tabs
                value={activeView}
                onValueChange={(key) => {
                    if (key !== null) onTabChange(String(key))
                }}
                className="gap-0"
            >
                <TabsList variant="line" size="sm">
                    {TAB_ITEMS.map((item) => (
                        <TabsTrigger key={item.key} value={item.key} size="sm" className="px-3">
                            {item.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>
        </div>
    )
})

export default SessionHeaderRight
