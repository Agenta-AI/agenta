import {atom} from "jotai"
import type {SetStateAction, WritableAtom} from "jotai"

interface BroadcastMessage<Value> {
    sourceId: string
    value: Value
}

/**
 * Creates an atom that broadcasts updates to other tabs/windows via BroadcastChannel.
 *
 * Note: Broadcast sync is best-effort and requires browser support.
 */
export function atomWithBroadcast<Value>(
    channelName: string,
    initialValue: Value,
): WritableAtom<Value, [SetStateAction<Value>], void> {
    const baseAtom = atom(initialValue)
    const sourceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    let channel: BroadcastChannel | null = null
    let mountCount = 0

    const getChannel = () => {
        if (typeof globalThis.BroadcastChannel !== "function") {
            return null
        }

        if (!channel) {
            channel = new BroadcastChannel(channelName)
        }

        return channel
    }

    baseAtom.onMount = (setSelf) => {
        const activeChannel = getChannel()

        if (!activeChannel) {
            return
        }

        mountCount += 1

        const handleMessage = (event: MessageEvent<BroadcastMessage<Value>>) => {
            const message = event.data

            if (!message || message.sourceId === sourceId) {
                return
            }

            setSelf(message.value)
        }

        activeChannel.addEventListener("message", handleMessage)

        return () => {
            activeChannel.removeEventListener("message", handleMessage)
            mountCount -= 1

            if (mountCount === 0 && channel === activeChannel) {
                activeChannel.close()
                channel = null
            }
        }
    }

    return atom(
        (get) => get(baseAtom),
        (get, set, update: SetStateAction<Value>) => {
            const currentValue = get(baseAtom)
            const nextValue =
                typeof update === "function"
                    ? (update as (previousValue: Value) => Value)(currentValue)
                    : update

            set(baseAtom, nextValue)

            const activeChannel = getChannel()
            if (!activeChannel) {
                return
            }

            activeChannel.postMessage({
                sourceId,
                value: nextValue,
            } satisfies BroadcastMessage<Value>)
        },
    )
}
