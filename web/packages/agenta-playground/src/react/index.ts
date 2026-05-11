/**
 * @agenta/playground/react - React Bindings for Playground State
 *
 * For state management, use controllers directly:
 *
 * ```typescript
 * import { playgroundController, executionController } from '@agenta/playground'
 * import { useAtomValue, useSetAtom } from 'jotai'
 *
 * const nodes = useAtomValue(playgroundController.selectors.nodes())
 * const runStep = useSetAtom(executionController.actions.runStepWithContext)
 * ```
 */
