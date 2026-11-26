/**
 * SimpleQueue API - HTTP functions
 */

export {
    // Create
    createSimpleQueue,
    type CreateSimpleQueuePayload,
    // Query / List
    querySimpleQueues,
    // Fetch (single)
    fetchSimpleQueue,
    // Edit
    editSimpleQueue,
    type EditSimpleQueuePayload,
    // Delete
    deleteSimpleQueue,
    deleteSimpleQueues,
    // Scenarios
    querySimpleQueueScenarios,
    // Add items
    addSimpleQueueTraces,
    addSimpleQueueTestcases,
} from "./api"
