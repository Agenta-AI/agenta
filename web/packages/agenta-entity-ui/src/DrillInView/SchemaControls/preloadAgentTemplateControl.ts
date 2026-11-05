/** Warm the agent-template chunk during idle time (e.g. as soon as the playground knows the
 * app is an agent), so its download + execution doesn't coincide with the revision/schema
 * resolving — that combination is a main-thread burst right as the panel paints.
 *
 * Alone in this file so a caller on the chat route reaches it without the schema renderers. */
export const preloadAgentTemplateControl = () => import("./AgentTemplateControl")
