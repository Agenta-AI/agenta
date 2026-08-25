/**
 * The client-tool WIDGETS: the surfaces that answer a browser-fulfilled tool the runner parked
 * (#4920). Importing this module registers them into the shared chat skin; the dispatcher and the
 * predicate that route parts to them live in @agenta/chat/clientTools.
 *
 * They sit here rather than beside the dispatcher because the elicitation form is SchemaForm, whose
 * state engine is antd `Form`, and @agenta/chat is contractually antd-free so /m can ship it.
 */
export {clientToolWidgets} from "./registry"
export {default as ElicitationWidget} from "./ElicitationWidget"
export {default as ConnectToolWidget} from "./ConnectToolWidget"
export {useConnectFlow} from "./useConnectFlow"
