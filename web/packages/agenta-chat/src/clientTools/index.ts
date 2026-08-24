/**
 * Client-tool round-trip (#4920): a browser-fulfilled tool the runner emits-and-parks, dispatched
 * by `render.kind` → `toolName` → a neutral "not handled" fallback.
 *
 * Only the DISPATCH lives here. The widgets themselves are in @agenta/entity-ui/clientTools,
 * because the elicitation form is built on SchemaForm, whose state engine is antd `Form` — and this
 * package is contractually antd-free so that /m can ship it (see tests/unit/package.test.ts).
 * Both halves meet through the skin registry in ../skin, which is where the store lives.
 */
export {default as ClientToolPart, type ClientToolOutputHandler} from "./ClientToolPart"
export {clientToolMeta, isClientToolPart, clientToolName} from "./meta"
export {getPendingConnectInteractions} from "./connectInteractions"
