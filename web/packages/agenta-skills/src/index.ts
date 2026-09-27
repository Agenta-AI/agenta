/**
 * @agenta/skills — headless skill-registry logic: schema, API calls, atoms, and the
 * embed writer. UI lives in @agenta/skills-ui; hosts wire both together.
 *
 * The `./state` subpath export exposes the atoms on their own; this barrel re-exports
 * everything, including the API calls and the embed writer.
 */
export * from "./core/schema"
export * from "./api"
export * from "./state"
export * from "./embed"
