/**
 * RuntimeLens (build-spec §4.3) — absorbs the old Streams + States + Mounts tabs as three
 * sub-cards: Lifecycle (+ Attach/Detach/Kill), State, Mounts. Pure reuse of the existing
 * SessionInspector tabs (already session-scoped, endpoint-backed). Session vs Turn scope reads
 * the same live facts; Turn just labels them session-wide (build-spec §3).
 */
import MountsTab from "@/oss/components/SessionInspector/tabs/MountsTab"
import StatesTab from "@/oss/components/SessionInspector/tabs/StatesTab"
import StreamsTab from "@/oss/components/SessionInspector/tabs/StreamsTab"

import type {InspectorScope} from "../state"

const Card = ({
    title,
    note,
    children,
}: {
    title: string
    note?: string
    children: React.ReactNode
}) => (
    <section className="flex flex-col gap-2 rounded border border-solid border-[#24262b] bg-[#0f1012] p-3">
        <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold">{title}</span>
            {note ? <span className="text-[10px] text-colorTextQuaternary">{note}</span> : null}
        </div>
        {children}
    </section>
)

export function RuntimeLens({sessionId, scope}: {sessionId: string; scope: InspectorScope}) {
    const note = scope === "turn" ? "session-wide" : undefined
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            <Card title="Lifecycle" note={note}>
                <StreamsTab sessionId={sessionId} />
            </Card>
            <Card title="State" note={note}>
                <StatesTab sessionId={sessionId} />
            </Card>
            <Card title="Mounts" note={note}>
                <MountsTab sessionId={sessionId} />
            </Card>
        </div>
    )
}
