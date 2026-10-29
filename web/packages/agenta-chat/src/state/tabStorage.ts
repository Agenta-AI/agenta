import {createJSONStorage} from "jotai/utils"

/**
 * localStorage WITHOUT jotai's cross-browser-tab sync — the storage every persisted atom in this
 * package uses.
 *
 * The default storage subscribes to the `storage` event, so a write in one browser tab replaces the
 * value live in every other one. For the transcript store that UNMOUNTED a streaming conversation
 * (the open-tab list drives the antd `Tabs` items), orphaning its `useChat` stream mid-turn; for the
 * Build/Chat layout mode it would rearrange a window the user is not looking at. Each browser tab
 * owns its own view; the storage is still shared, so a reload picks up whatever was last written.
 */
export const tabLocalStorage = <T>() => {
    const storage = createJSONStorage<T>()
    delete storage.subscribe
    return storage
}
