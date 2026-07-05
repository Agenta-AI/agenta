import {Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/primitive-ui/components/tabs"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {useAtomValue, useSetAtom} from "jotai"

import {
    closeSessionInspectorAtom,
    sessionInspectorOpenAtom,
    sessionInspectorSessionIdAtom,
} from "./store"
import InteractionsTab from "./tabs/InteractionsTab"
import MountsTab from "./tabs/MountsTab"
import RecordsTab from "./tabs/RecordsTab"
import StatesTab from "./tabs/StatesTab"
import StreamsTab from "./tabs/StreamsTab"

const SessionInspectorDrawer = () => {
    const open = useAtomValue(sessionInspectorOpenAtom)
    const sessionId = useAtomValue(sessionInspectorSessionIdAtom)
    const close = useSetAtom(closeSessionInspectorAtom)

    return (
        <EnhancedDrawer
            open={open}
            onClose={() => close()}
            width={640}
            closeOnLayoutClick={false}
            title={
                <div className="flex flex-col">
                    <span>Session inspector</span>
                    <span className="text-xs font-normal font-mono text-muted-foreground">
                        {sessionId ?? "—"}
                    </span>
                </div>
            }
        >
            {sessionId ? (
                <Tabs defaultValue="streams">
                    <TabsList variant="line">
                        <TabsTrigger value="streams">Streams</TabsTrigger>
                        <TabsTrigger value="records">Records</TabsTrigger>
                        <TabsTrigger value="states">States</TabsTrigger>
                        <TabsTrigger value="mounts">Mounts</TabsTrigger>
                        <TabsTrigger value="interactions">Interactions</TabsTrigger>
                    </TabsList>
                    <TabsContent value="streams" keepMounted>
                        <StreamsTab sessionId={sessionId} />
                    </TabsContent>
                    <TabsContent value="records" keepMounted>
                        <RecordsTab sessionId={sessionId} />
                    </TabsContent>
                    <TabsContent value="states" keepMounted>
                        <StatesTab sessionId={sessionId} />
                    </TabsContent>
                    <TabsContent value="mounts" keepMounted>
                        <MountsTab sessionId={sessionId} />
                    </TabsContent>
                    <TabsContent value="interactions" keepMounted>
                        <InteractionsTab sessionId={sessionId} />
                    </TabsContent>
                </Tabs>
            ) : null}
        </EnhancedDrawer>
    )
}

export default SessionInspectorDrawer
