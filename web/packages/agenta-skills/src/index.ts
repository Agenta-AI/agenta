/**
 * @agenta/skills — headless skill-registry logic: schema, API calls, atoms, and the
 * embed writer. UI lives in @agenta/skills-ui; hosts wire both together.
 *
 * Subpath exports (`./state`, `./api`, `./embed`) are the preferred entry points;
 * this barrel re-exports them for convenience.
 */
export * from "./api"
export * from "./state"
export * from "./embed"
