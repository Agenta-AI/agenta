/**
 * Client-tool round-trip (#4920): a browser-fulfilled tool the runner emits-and-parks, dispatched
 * here by `render.kind` → `toolName` → a neutral "not handled" fallback. v1 ships the
 * connect widget (`request_connection`). See `types.ts` for the contract.
 */
export {default as ClientToolPart, type ClientToolOutputHandler} from "./ClientToolPart"
export {clientToolMeta, isClientToolPart, clientToolName} from "./meta"
export {hasClientToolHandler, resolveClientToolHandler} from "./registry"
export type {ClientToolMeta, ClientToolHandlerProps} from "./types"
