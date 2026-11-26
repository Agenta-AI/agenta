/**
 * The app runner, behind its own module: `useScenarioInvocation` loads it with `import()` when Run
 * is clicked. The named import keeps the rest of `@agenta/playground` out of the loaded chunk.
 */
export {runScenarioInvocation} from "@agenta/playground"
