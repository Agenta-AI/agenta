/**
 * Leader election among the visible tabs of one origin, over a `BroadcastChannel`.
 *
 * Over HTTP/1.1 a browser opens at most six connections per origin, and every open watch stream
 * holds one for good. A stream that every tab opens for itself (the project watch) therefore eats
 * one connection per tab, and a few tabs leave nothing for sends and reads. With this, one tab
 * normally holds the stream and relays its events to the others. It is an election, not a lock:
 * two tabs can both lead (and both hold the stream) until they hear each other's beat, which
 * settles it within a beat or two.
 *
 * The protocol, on one channel per watch URL:
 * - The leader posts a `beat` every `BEAT_MS` and relays each stream event as `relay`.
 * - A tab that joins asks `who`; a leader answers with a beat at once.
 * - A tab that hears no beat for `LEADER_TIMEOUT_MS` takes the lead. Two leaders that hear each
 *   other resolve on the beat: the tab that joined first keeps it, the other steps down.
 * - A leader that leaves (hidden, unmounted) posts `resign`, and the others take over at once.
 *
 * `BroadcastChannel` needs no secure context, unlike Web Locks, so this also works on a plain
 * `http://` deployment, which is exactly where the connection cap bites.
 */

export const BEAT_MS = 1_000
export const LEADER_TIMEOUT_MS = 3_000
/** How long a joining tab waits for a leader to answer `who` before it leads. */
export const JOIN_WAIT_MS = 300
const WATCHDOG_TICK_MS = 100

type TabMessage =
    | {type: "beat"; id: number}
    | {type: "who"}
    | {type: "resign"; id: number}
    | {type: "relay"; id: number; payload: unknown}

/** The subset of `BroadcastChannel` this module uses; a test passes an in-memory one. */
export interface TabChannel {
    postMessage: (message: unknown) => void
    onmessage: ((event: MessageEvent) => void) | null
    close: () => void
}

export interface TabLeadership {
    /** Leader only: hands a stream event to every other tab. */
    relay: (payload: unknown) => void
    /** Stop taking part; a leader resigns so another tab takes over at once. */
    leave: () => void
}

const defaultChannel = (name: string): TabChannel | null =>
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(name)

/**
 * Join the election for `channelName`. Returns `null` when the browser has no `BroadcastChannel`;
 * the caller then holds its own stream, as before.
 */
export const joinTabLeadership = ({
    channelName,
    onLeadChange,
    onRelay,
    createChannel = defaultChannel,
}: {
    channelName: string
    /** `true` when this tab must open the stream, `false` when it must close it. */
    onLeadChange: (leading: boolean) => void
    /** A stream event another tab relayed. */
    onRelay: (payload: unknown) => void
    createChannel?: (name: string) => TabChannel | null
}): TabLeadership | null => {
    const channel = createChannel(channelName)
    if (!channel) return null

    // Time of joining, so the older tab wins a tie; the random part only breaks exact ties.
    const id = Date.now() + Math.random()
    let leading = false
    let left = false
    let lastBeatAt = Date.now() - LEADER_TIMEOUT_MS + JOIN_WAIT_MS
    let beatTimer: ReturnType<typeof setInterval> | undefined

    const post = (message: TabMessage) => channel.postMessage(message)

    const lead = () => {
        if (leading || left) return
        leading = true
        post({type: "beat", id})
        beatTimer = setInterval(() => post({type: "beat", id}), BEAT_MS)
        onLeadChange(true)
    }

    const stepDown = () => {
        if (!leading) return
        leading = false
        if (beatTimer !== undefined) clearInterval(beatTimer)
        beatTimer = undefined
        onLeadChange(false)
    }

    channel.onmessage = ({data}) => {
        if (left || !data || typeof data !== "object") return
        const message = data as TabMessage
        if (message.type === "who") {
            if (leading) post({type: "beat", id})
            return
        }
        if (message.type === "beat") {
            if (leading && message.id > id) return
            // A leader that hears an older one steps down; the stream it closes is the duplicate.
            if (leading) stepDown()
            lastBeatAt = Date.now()
            return
        }
        if (message.type === "resign") {
            // Spread the takeover over the join window, so the first tab to lead is usually heard
            // before the rest time out and no duplicate stream opens.
            lastBeatAt = Date.now() - LEADER_TIMEOUT_MS + Math.random() * JOIN_WAIT_MS
            return
        }
        if (message.type === "relay" && !leading) onRelay(message.payload)
    }

    const watchdog = setInterval(() => {
        if (!leading && Date.now() - lastBeatAt > LEADER_TIMEOUT_MS) lead()
    }, WATCHDOG_TICK_MS)
    post({type: "who"})

    return {
        relay: (payload) => {
            if (leading && !left) post({type: "relay", id, payload})
        },
        leave: () => {
            if (left) return
            clearInterval(watchdog)
            if (leading) {
                post({type: "resign", id})
                stepDown()
            }
            left = true
            channel.onmessage = null
            channel.close()
        },
    }
}
