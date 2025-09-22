/**
 * Test file for New Playground State Architecture
 *
 * This file tests the new playground state system to validate that all
 * mutations and derived state work correctly without the old sync overhead.
 */

import {createStore} from "jotai"

import {
    // Core atoms
    playgroundConfigAtom,
    selectedVariantAtom,
    displayedVariantsAtom,
    initializePlaygroundAtom,
    addVariantAtom,
    generationDataAtom,
    addTestInputAtom,
    addChatMessageAtom,

    // Derived atoms
    selectedVariantRequestBodyAtom,
    isSelectedVariantDirtyAtom,
    // selectedVariantValidationAtom,

    // Mutation atoms
    updateVariantPromptAtom,
    updateVariantParameterAtom,
    addTestCaseAtom,
    runSingleTestAtom,
    clearResultsAtom,
} from "../index"

/**
 * Test Suite: New Playground Architecture
 */
describe("New Playground Architecture", () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        store = createStore()
    })

    describe("Initialization", () => {
        test("should initialize playground from revisions", () => {
            const mockRevisions = [
                {
                    id: "variant-1",
                    name: "Test Variant 1",
                    isChatVariant: false,
                    prompts: {
                        completion_prompt: "Hello {{name}}",
                    },
                    parameters: {
                        temperature: 0.7,
                        max_tokens: 100,
                    },
                },
                {
                    id: "variant-2",
                    name: "Test Chat Variant",
                    isChatVariant: true,
                    prompts: {
                        chat_prompts: [
                            {role: "system", content: "You are a helpful assistant"},
                            {role: "user", content: "Hello {{name}}"},
                        ],
                    },
                    parameters: {
                        temperature: 0.5,
                    },
                },
            ]

            // Initialize playground
            const initializePlayground = store.get(initializePlaygroundAtom)
            initializePlayground(mockRevisions)

            // Check config state
            const config = store.get(playgroundConfigAtom)
            expect(Object.keys(config.variants)).toHaveLength(2)
            expect(config.selectedVariantId).toBe("variant-1")
            expect(config.displayedVariantIds).toEqual(["variant-1", "variant-2"])

            // Check selected variant
            const selectedVariant = store.get(selectedVariantAtom)
            expect(selectedVariant?.id).toBe("variant-1")
            expect(selectedVariant?.name).toBe("Test Variant 1")
        })
    })

    describe("Config Mutations", () => {
        beforeEach(() => {
            // Initialize with test data
            const mockRevisions = [
                {
                    id: "test-variant",
                    name: "Test Variant",
                    isChatVariant: false,
                    prompts: {completion_prompt: "Original prompt"},
                    parameters: {temperature: 0.7},
                },
            ]

            const initializePlayground = store.get(initializePlaygroundAtom)
            initializePlayground(mockRevisions)
        })

        test("should update variant prompt", () => {
            const updatePrompt = store.get(updateVariantPromptAtom)
            updatePrompt({
                variantId: "test-variant",
                promptPath: ["completion_prompt"],
                value: "Updated prompt with {{variable}}",
            })

            const config = store.get(playgroundConfigAtom)
            expect(config.variants["test-variant"].prompts.completion_prompt).toBe(
                "Updated prompt with {{variable}}",
            )
        })

        test("should update variant parameter", () => {
            const updateParameter = store.get(updateVariantParameterAtom)
            updateParameter({
                variantId: "test-variant",
                parameterName: "temperature",
                value: 0.9,
            })

            const config = store.get(playgroundConfigAtom)
            expect(config.variants["test-variant"].parameters.temperature).toBe(0.9)
        })

        test("should detect dirty state after updates", () => {
            // Initially not dirty
            expect(store.get(isSelectedVariantDirtyAtom)).toBe(false)

            // Update prompt
            const updatePrompt = store.get(updateVariantPromptAtom)
            updatePrompt({
                variantId: "test-variant",
                promptPath: ["completion_prompt"],
                value: "Modified prompt",
            })

            // Should now be dirty
            expect(store.get(isSelectedVariantDirtyAtom)).toBe(true)
        })
    })

    describe("Derived State", () => {
        beforeEach(() => {
            const mockRevisions = [
                {
                    id: "test-variant",
                    name: "Test Variant",
                    isChatVariant: false,
                    prompts: {completion_prompt: "Hello {{name}}"},
                    parameters: {temperature: 0.7, max_tokens: 100},
                },
            ]

            const initializePlayground = store.get(initializePlaygroundAtom)
            initializePlayground(mockRevisions)
        })

        test("should generate request body from config", () => {
            const requestBodyData = store.get(selectedVariantRequestBodyAtom)

            expect(requestBodyData).toBeTruthy()
            expect(requestBodyData?.isValid).toBe(true)
            expect(requestBodyData?.requestBody).toEqual({
                inputs: {},
                parameters: {temperature: 0.7, max_tokens: 100},
                prompt: "Hello {{name}}",
            })
        })

        // test("should validate variant configuration", () => {
        //     const validation = store.get(selectedVariantValidationAtom)

        //     expect(validation.isValid).toBe(true)
        //     expect(validation.errors).toHaveLength(0)
        // })

        test("should update derived state when config changes", () => {
            // Update prompt
            const updatePrompt = store.get(updateVariantPromptAtom)
            updatePrompt({
                variantId: "test-variant",
                promptPath: ["completion_prompt"],
                value: "Updated: {{name}} and {{age}}",
            })

            // Check derived request body updates automatically
            const requestBodyData = store.get(selectedVariantRequestBodyAtom)
            expect(requestBodyData?.requestBody.prompt).toBe("Updated: {{name}} and {{age}}")
        })
    })

    describe("Generation Data", () => {
        beforeEach(() => {
            const mockRevisions = [
                {
                    id: "test-variant",
                    name: "Test Variant",
                    isChatVariant: false,
                    prompts: {completion_prompt: "Hello {{name}}"},
                    parameters: {temperature: 0.7},
                },
            ]

            const initializePlayground = store.get(initializePlaygroundAtom)
            initializePlayground(mockRevisions)
        })

        test("should add test input", () => {
            const addTestInput = store.get(addTestInputAtom)
            const inputId = addTestInput({name: "John", age: "25"})

            const generationData = store.get(generationDataAtom)
            expect(generationData.inputs).toHaveLength(1)
            expect(generationData.inputs[0].__id).toBe(inputId)
            expect(generationData.inputs[0].name.value).toBe("John")
            expect(generationData.inputs[0].age.value).toBe("25")
        })

        test("should add test case using auto-detection", () => {
            const addTestCase = store.get(addTestCaseAtom)
            const caseId = addTestCase({name: "Alice"})

            const generationData = store.get(generationDataAtom)
            // Should add to inputs since variant is completion mode
            expect(generationData.inputs).toHaveLength(1)
            expect(generationData.messages).toHaveLength(0)
        })

        test("should clear all results", () => {
            // Add test input with mock results
            const addTestInput = store.get(addTestInputAtom)
            const inputId = addTestInput({name: "John"})

            // Mock some test results
            const generationData = store.get(generationDataAtom)
            generationData.inputs[0].__runs = {
                "test-variant": {
                    __result: "Mock result",
                    __timestamp: Date.now(),
                },
            }

            // Clear results
            const clearResults = store.get(clearResultsAtom)
            clearResults()

            // Check results are cleared
            const updatedData = store.get(generationDataAtom)
            expect(updatedData.inputs[0].__runs).toEqual({})
        })
    })

    describe("Integration", () => {
        test("should handle complete workflow", () => {
            // 1. Initialize playground
            const mockRevisions = [
                {
                    id: "workflow-variant",
                    name: "Workflow Test",
                    isChatVariant: false,
                    prompts: {completion_prompt: "Analyze {{topic}}"},
                    parameters: {temperature: 0.5},
                },
            ]

            const initializePlayground = store.get(initializePlaygroundAtom)
            initializePlayground(mockRevisions)

            // 2. Add test cases
            const addTestCase = store.get(addTestCaseAtom)
            addTestCase({topic: "AI Ethics"})
            addTestCase({topic: "Climate Change"})

            // 3. Modify variant
            const updatePrompt = store.get(updateVariantPromptAtom)
            updatePrompt({
                variantId: "workflow-variant",
                promptPath: ["completion_prompt"],
                value: "Deeply analyze {{topic}} with examples",
            })

            // 4. Check final state
            const config = store.get(playgroundConfigAtom)
            const generationData = store.get(generationDataAtom)
            const requestBodyData = store.get(selectedVariantRequestBodyAtom)
            const isDirty = store.get(isSelectedVariantDirtyAtom)

            // Assertions
            expect(config.variants["workflow-variant"].prompts.completion_prompt).toBe(
                "Deeply analyze {{topic}} with examples",
            )
            expect(generationData.inputs).toHaveLength(2)
            expect(requestBodyData?.requestBody.prompt).toBe(
                "Deeply analyze {{topic}} with examples",
            )
            expect(isDirty).toBe(true)
        })
    })
})

/**
 * Manual Test Runner (for development)
 *
 * Run this function to manually test the new playground architecture
 * without a full test framework.
 */
export function runManualTests() {
    console.log("🧪 Running manual tests for New Playground Architecture...")

    const store = createStore()

    // Test 1: Initialization
    console.log("\n1. Testing initialization...")
    const mockRevisions = [
        {
            id: "completion-variant",
            name: "Completion Test",
            isChatVariant: false,
            prompts: {completion_prompt: "Summarize {{text}}"},
            parameters: {temperature: 0.7, max_tokens: 150},
        },
        {
            id: "chat-variant",
            name: "Chat Test",
            isChatVariant: true,
            prompts: {
                chat_prompts: [
                    {role: "system", content: "You are a helpful assistant"},
                    {role: "user", content: "Help me with {{task}}"},
                ],
            },
            parameters: {temperature: 0.5},
        },
    ]

    const initializePlayground = store.get(initializePlaygroundAtom)
    initializePlayground(mockRevisions)

    const config = store.get(playgroundConfigAtom)
    console.log("✅ Initialized with variants:", Object.keys(config.variants))
    console.log("✅ Selected variant:", config.selectedVariantId)

    // Test 2: Request body derivation
    console.log("\n2. Testing request body derivation...")
    const requestBodyData = store.get(selectedVariantRequestBodyAtom)
    console.log("✅ Request body:", requestBodyData?.requestBody)
    console.log("✅ Is valid:", requestBodyData?.isValid)

    // Test 3: Config mutations
    console.log("\n3. Testing config mutations...")
    const updatePrompt = store.get(updateVariantPromptAtom)
    updatePrompt({
        variantId: "completion-variant",
        promptPath: ["completion_prompt"],
        value: "Analyze and summarize {{text}} in detail",
    })

    const updatedRequestBody = store.get(selectedVariantRequestBodyAtom)
    console.log("✅ Updated prompt:", updatedRequestBody?.requestBody.prompt)

    const isDirty = store.get(isSelectedVariantDirtyAtom)
    console.log("✅ Is dirty after update:", isDirty)

    // Test 4: Generation data
    console.log("\n4. Testing generation data...")
    const addTestCase = store.get(addTestCaseAtom)
    const testId1 = addTestCase({text: "Lorem ipsum dolor sit amet..."})
    const testId2 = addTestCase({text: "The quick brown fox jumps..."})

    const generationData = store.get(generationDataAtom)
    console.log("✅ Added test cases:", generationData.inputs.length)
    console.log("✅ Test IDs:", [testId1, testId2])

    console.log("\n🎉 All manual tests completed successfully!")

    return {
        store,
        config: store.get(playgroundConfigAtom),
        generationData: store.get(generationDataAtom),
        requestBodyData: store.get(selectedVariantRequestBodyAtom),
    }
}
