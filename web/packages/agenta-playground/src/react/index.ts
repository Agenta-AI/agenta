/**
 * @agenta/playground/react - React Bindings for Playground State
 *
 * Thin React wrappers around playground controllers.
 * All business logic lives in controllers - these hooks just connect them to React.
 *
 * ## Usage
 *
 * ```typescript
 * import { usePlaygroundState, useChainExecution, useDerivedState } from '@agenta/playground/react'
 *
 * function MyComponent() {
 *   const { primaryNode, addPrimaryNode, nodes, allConnections } = usePlaygroundState()
 *   const { executeRow, isExecuting } = useChainExecution(loadableId)
 *
 *   // Transform controller state to view model types
 *   const { runnableNodes, outputReceivers } = useDerivedState({
 *     primaryNode, nodes, allConnections, editingConnectionId, loadable, extraColumns
 *   })
 *
 *   return <button onClick={() => addPrimaryNode(selection)}>Add</button>
 * }
 * ```
 *
 * ## Pure Jotai Alternative
 *
 * If you prefer direct controller access without hooks:
 *
 * ```typescript
 * import { playgroundController, executionController } from '@agenta/playground'
 * import { useAtomValue, useSetAtom } from 'jotai'
 *
 * const nodes = useAtomValue(playgroundController.selectors.nodes())
 * const executeRow = useSetAtom(executionController.actions.executeRow)
 * ```
 */

export {usePlaygroundState} from "./usePlaygroundState"
export {useChainExecution, type UseChainExecutionReturn} from "./useChainExecution"
export {useDerivedState, type DerivedStateParams} from "./useDerivedState"
