/**
 * Auto-Agenta: Onboarding Evaluation Harness
 *
 * Dogfood harness that evaluates the rh-onboarding prompt module
 * using the local evaluation orchestrator.
 *
 * Components:
 *   1. Test case definitions for the 3-step onboarding flow
 *   2. Evaluator definitions (LLM-as-a-Judge for tone, structure, tool usage)
 *   3. Conversation simulator (multi-turn invoke function)
 *   4. Harness runner that wires everything to runLocalEvaluation
 */

import type {Agenta} from "../index"

import {
    runLocalEvaluation,
    type InvokeResult,
    type EvalResult,
    type LocalEvaluationResult,
} from "./run-local-evaluation"

// ---------------------------------------------------------------------------
// 1. Test Case Definitions
// ---------------------------------------------------------------------------

/**
 * Test cases model the onboarding conversation.
 * Each test case represents a complete multi-turn scenario.
 *
 * Fields:
 *   - persona: who the user is (affects expected tone calibration)
 *   - turns: array of user messages simulating the 3-step flow
 *   - expected_tools: tools that should be called at each step
 *   - constraints: what to check in agent responses
 */
export const ONBOARDING_TEST_CASES: Record<string, unknown>[] = [
    // --- Happy path: Shopify store ---
    {
        id: "shopify-happy-path",
        persona: "casual coffee roaster, non-technical",
        turns: [
            {user: "hi", step: 1},
            {user: "thebarn.com", step: 2},
            {user: "specialty coffee beans and brewing equipment", step: 3},
        ],
        expected_tools_per_step: {
            1: ["getUserContext"],
            2: ["detectStore", "savePreference"],
            3: [],
        },
        constraints: [
            "max_2_sentences_per_response",
            "no_structured_data_listing",
            "no_menu_of_options",
            "no_filler_phrases",
            "stops_after_question",
            "asks_for_store_url_step1",
            "casual_tone",
        ],
    },

    // --- Happy path: WooCommerce store ---
    {
        id: "woocommerce-happy-path",
        persona: "organized small business owner, slightly technical",
        turns: [
            {user: "hello!", step: 1},
            {user: "https://myshop.example.com", step: 2},
            {user: "handmade candles and home decor", step: 3},
        ],
        expected_tools_per_step: {
            1: ["getUserContext"],
            2: ["detectStore", "savePreference"],
            3: [],
        },
        constraints: [
            "max_2_sentences_per_response",
            "no_structured_data_listing",
            "casual_tone",
            "stops_after_question",
        ],
    },

    // --- Edge case: user gives URL immediately ---
    {
        id: "url-first-message",
        persona: "busy, impatient store owner",
        turns: [
            {user: "mybeans.com", step: 1},
            {user: "organic coffee from Colombia", step: 3},
        ],
        expected_tools_per_step: {
            1: ["getUserContext", "detectStore", "savePreference"],
            3: [],
        },
        constraints: [
            "max_2_sentences_per_response",
            "no_structured_data_listing",
            "adapts_to_skipped_step",
        ],
    },

    // --- Edge case: vague first message ---
    {
        id: "vague-greeting",
        persona: "confused first-timer",
        turns: [
            {user: "hey, what can you do?", step: 1},
            {user: "sure, it's artisansoaps.com", step: 2},
            {user: "handmade soaps and bath products", step: 3},
        ],
        expected_tools_per_step: {
            1: ["getUserContext"],
            2: ["detectStore", "savePreference"],
            3: [],
        },
        constraints: [
            "max_2_sentences_per_response",
            "no_capability_listing",
            "steers_to_store_url",
            "casual_tone",
        ],
    },

    // --- Anti-pattern check: should NOT list features ---
    {
        id: "feature-list-trap",
        persona: "curious shopper",
        turns: [{user: "what can you help me with?", step: 1}],
        expected_tools_per_step: {
            1: ["getUserContext"],
        },
        constraints: [
            "max_2_sentences_per_response",
            "no_capability_listing",
            "no_menu_of_options",
            "steers_to_store_url",
        ],
    },

    // --- Anti-pattern check: should NOT dump detected data ---
    {
        id: "no-data-dump",
        persona: "normal store owner",
        turns: [
            {user: "hi there", step: 1},
            {user: "https://thebarn.com", step: 2},
        ],
        expected_tools_per_step: {
            1: ["getUserContext"],
            2: ["detectStore", "savePreference"],
        },
        constraints: [
            "no_structured_data_listing",
            "max_2_sentences_per_response",
            "casual_reaction_to_detection",
            "stops_after_question",
        ],
    },
]

// ---------------------------------------------------------------------------
// 2. Evaluator Definitions (LLM-as-a-Judge prompts)
// ---------------------------------------------------------------------------

/**
 * Each evaluator checks one specific constraint.
 * These map to the auto_ai_critique template in Agenta.
 */
export const EVALUATOR_CONFIGS = {
    "tone-check": {
        name: "Tone & Brevity",
        description: "Checks casual tone, max 2 sentences, no filler",
        prompt: `You are evaluating an AI assistant's response for tone and brevity.

The assistant should:
- Use warm, casual language (like a coworker, not a bot)
- Use contractions (I'll, you're, that's)
- React naturally ("nice!", "got it", "cool")
- Keep responses to MAX 2 sentences
- NEVER use filler phrases like "feel free to...", "I'm here to help!", "Just let me know!"
- NEVER write multiple paragraphs

Score 1.0 if ALL criteria met.
Score 0.5 if mostly good but one minor violation.
Score 0.0 if robotic tone, too verbose, or contains filler.

Evaluate the assistant's response below.`,
    },

    "structure-check": {
        name: "Response Structure",
        description: "Checks single question, no lists, no menus, stops when asking",
        prompt: `You are evaluating an AI assistant's response structure.

The assistant should:
- Ask ONE question at a time, then STOP
- NEVER list capabilities or features as a menu
- NEVER present structured data (like "Platform: Shopify, Currency: USD")
- NEVER offer multiple options in one response
- After asking a question, the response should end immediately — no follow-up paragraphs

Score 1.0 if the response asks one thing and stops.
Score 0.5 if mostly good but has a minor structural issue.
Score 0.0 if it lists features, dumps structured data, or continues after asking a question.

Evaluate the assistant's response below.`,
    },

    "tool-usage-check": {
        name: "Tool Usage",
        description: "Checks correct tools called at each onboarding step",
        prompt: `You are evaluating whether an AI assistant called the correct tools during onboarding.

Expected behavior:
- Step 1 (greeting): MUST call getUserContext
- Step 2 (user gives URL): MUST call detectStore AND savePreference
- Step 3 (user describes products): Should suggest a next action

The input includes expected_tools_per_step and the actual tool calls made.

Score 1.0 if all expected tools were called correctly.
Score 0.5 if most tools were called but one was missing.
Score 0.0 if critical tools were missed (e.g., no getUserContext on start, no detectStore after URL).

Evaluate the tool calls below.`,
    },

    "conversation-flow-check": {
        name: "Conversation Flow",
        description: "Checks the overall 3-step onboarding flow progression",
        prompt: `You are evaluating the overall flow of an onboarding conversation.

Expected 3-step flow:
1. Ask for store URL (and nothing else)
2. React casually to detected store info, ask about products
3. Suggest ONE specific next action based on what was learned

The assistant should:
- Progress naturally through steps without skipping or repeating
- Adapt if the user provides information out of order
- Never re-ask for information already provided
- Never ask "which platform do you use?" — detect it from the URL instead

Score 1.0 if the flow is natural and follows the expected progression.
Score 0.5 if the flow is mostly correct but has a minor issue.
Score 0.0 if the flow is broken, repetitive, or asks for information it should detect.

Evaluate the conversation below.`,
    },
}

// ---------------------------------------------------------------------------
// 3. Evaluator Setup Helpers
// ---------------------------------------------------------------------------

/**
 * Creates LLM-as-a-Judge evaluators in Agenta using the auto_ai_critique template.
 * Returns a map of evaluator slug → revision ID.
 */
export async function setupOnboardingEvaluators(ag: Agenta): Promise<Record<string, string>> {
    const revisionIds: Record<string, string> = {}

    for (const [slug, config] of Object.entries(EVALUATOR_CONFIGS)) {
        const fullSlug = `rh-onboarding-${slug}`

        // Check if evaluator already exists
        const existing = await ag.evaluators.findBySlug(fullSlug)

        if (!existing) {
            // Create via workflows (evaluators are workflows with is_evaluator flag)
            const created = await ag.workflows.createEvaluator({
                slug: fullSlug,
                name: config.name,
                description: config.description,
                catalogTemplateKey: "auto_ai_critique",
                data: {
                    uri: "agenta:builtin:auto_ai_critique:v0",
                    parameters: {
                        prompt: {
                            messages: [
                                {role: "system", content: config.prompt},
                                {
                                    role: "user",
                                    content:
                                        'Input: {{input}}\n\nAssistant Response: {{output}}\n\nProvide your evaluation as JSON: { "score": <0-1>, "reasoning": "..." }',
                                },
                            ],
                            llm_config: {
                                model: "anthropic/claude-sonnet-4-20250514",
                                temperature: 0,
                                max_tokens: 500,
                            },
                        },
                    },
                },
                message: "Auto-created by onboarding eval harness",
            })

            // Workflow.id IS the revision ID (create commits and returns the revision)
            revisionIds[slug] = created.id
        } else {
            // Fetch latest revision for existing evaluator
            const evalId = existing.id
            if (evalId) {
                const latest = await ag.workflows.fetchLatest(evalId)
                if (latest?.id) {
                    revisionIds[slug] = latest.id
                }
            }
        }
    }

    return revisionIds
}

// ---------------------------------------------------------------------------
// 4. Test Set Setup
// ---------------------------------------------------------------------------

/**
 * Creates (or updates) the onboarding test set in Agenta.
 * Returns the testset with its revision_id.
 */
export async function setupOnboardingTestSet(
    ag: Agenta,
): Promise<{testsetId: string; revisionId: string}> {
    const slug = "rh-onboarding-tests"

    // Check if test set already exists
    let testset = await ag.testsets.findBySlug(slug)

    if (testset) {
        // Update with latest test cases
        testset = await ag.testsets.update(testset.id!, {
            testcases: ONBOARDING_TEST_CASES,
        })
    } else {
        // Create new
        testset = await ag.testsets.create({
            slug,
            name: "Onboarding Test Cases",
            description: "Multi-turn conversation scenarios for rh-onboarding prompt evaluation",
            testcases: ONBOARDING_TEST_CASES,
        })
    }

    return {
        testsetId: testset.id!,
        revisionId: testset.revision_id!,
    }
}

// ---------------------------------------------------------------------------
// 5. Conversation Simulator (Multi-Turn Invoke)
// ---------------------------------------------------------------------------

/**
 * Creates an invoke function that simulates multi-turn onboarding conversations.
 *
 * @param callAgent - Your agent call function. Takes messages, returns response with content + tool calls.
 */
export function createOnboardingInvoke(
    callAgent: (messages: {role: "user" | "assistant"; content: string}[]) => Promise<{
        content: string
        toolCalls?: {name: string; args: Record<string, unknown>}[]
    }>,
): (testcaseData: Record<string, unknown>) => Promise<InvokeResult> {
    return async (testcaseData) => {
        const turns = testcaseData.turns as {
            user: string
            step: number
        }[]
        const messages: {role: "user" | "assistant"; content: string}[] = []
        const allToolCalls: {
            step: number
            name: string
            args: Record<string, unknown>
        }[] = []
        const responses: {step: number; content: string}[] = []

        for (const turn of turns) {
            // Add user message
            messages.push({role: "user", content: turn.user})

            // Call the agent
            const response = await callAgent([...messages])

            // Record response
            messages.push({role: "assistant", content: response.content})
            responses.push({step: turn.step, content: response.content})

            // Record tool calls
            if (response.toolCalls) {
                for (const tc of response.toolCalls) {
                    allToolCalls.push({step: turn.step, name: tc.name, args: tc.args})
                }
            }
        }

        return {
            output: {
                messages,
                responses,
                tool_calls: allToolCalls,
                persona: testcaseData.persona,
                expected_tools_per_step: testcaseData.expected_tools_per_step,
                constraints: testcaseData.constraints,
                turn_count: turns.length,
                completed: true,
            },
        }
    }
}

// ---------------------------------------------------------------------------
// 6. Evaluator Dispatch
// ---------------------------------------------------------------------------

/**
 * Creates an evaluate function that dispatches to the right evaluator logic.
 *
 * IMPORTANT: stepKey in runLocalEvaluation is the evaluator REVISION ID (a UUID),
 * not the evaluator slug. This function uses revisionIdToSlug to resolve the
 * revision ID back to the config slug for prompt lookup.
 *
 * @param callLLM - Function that calls an LLM with a prompt and returns structured output
 * @param revisionIdToSlug - Map from revision UUID → evaluator config slug (e.g., "tone-check")
 */
export function createOnboardingEvaluate(
    callLLM: (prompt: string) => Promise<{score: number; reasoning: string}>,
    revisionIdToSlug: Record<string, string>,
): (
    stepKey: string,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
) => Promise<EvalResult> {
    return async (stepKey, input, output) => {
        // stepKey is a revision ID — resolve to slug
        const slug = revisionIdToSlug[stepKey] ?? stepKey
        const config = EVALUATOR_CONFIGS[slug as keyof typeof EVALUATOR_CONFIGS]
        if (!config) {
            // Unknown evaluator — fail explicitly so we don't get false passes
            return {score: 0, reasoning: `Unknown evaluator slug: ${slug} (stepKey: ${stepKey})`}
        }

        // Build the evaluation prompt
        const evalPrompt = `${config.prompt}

---

Input (test case):
${JSON.stringify(input, null, 2)}

Assistant Output:
${JSON.stringify(output, null, 2)}

Provide your evaluation as JSON: { "score": <0 to 1>, "reasoning": "..." }`

        return callLLM(evalPrompt)
    }
}

// ---------------------------------------------------------------------------
// 7. Full Harness Runner
// ---------------------------------------------------------------------------

export interface OnboardingEvalHarnessOptions {
    /** Agenta SDK instance */
    ag: Agenta

    /** Application revision ID for rh-onboarding */
    appRevisionId: string

    /**
     * Function that calls the agent with a conversation history.
     * This is YOUR agent — the thing being evaluated.
     */
    callAgent: (messages: {role: "user" | "assistant"; content: string}[]) => Promise<{
        content: string
        toolCalls?: {name: string; args: Record<string, unknown>}[]
    }>

    /**
     * Function that calls an LLM for evaluation (judge).
     * Should return { score, reasoning }.
     */
    callJudge: (prompt: string) => Promise<{score: number; reasoning: string}>

    /** Optional name for this evaluation run */
    name?: string
}

/**
 * Run the full onboarding evaluation harness.
 *
 * 1. Sets up test set + evaluators in Agenta (idempotent)
 * 2. Creates & runs a local evaluation
 * 3. Returns results summary
 */
export async function runOnboardingEvaluation(
    options: OnboardingEvalHarnessOptions,
): Promise<LocalEvaluationResult & {evaluatorRevisionIds: Record<string, string>}> {
    const {ag, appRevisionId, callAgent, callJudge, name} = options

    console.log("🧪 Setting up onboarding evaluation...\n")

    // Setup test set
    console.log("  📋 Creating/updating test set...")
    const {revisionId: testsetRevisionId} = await setupOnboardingTestSet(ag)
    console.log(`     ✓ Test set ready (revision: ${testsetRevisionId.slice(0, 8)}...)\n`)

    // Setup evaluators
    console.log("  🔍 Creating/updating evaluators...")
    const evaluatorRevisionIds = await setupOnboardingEvaluators(ag)
    const evalCount = Object.keys(evaluatorRevisionIds).length
    console.log(`     ✓ ${evalCount} evaluators ready\n`)

    // Build reverse map: revision ID → slug (for evaluator dispatch)
    const revisionIdToSlug: Record<string, string> = {}
    for (const [slug, revId] of Object.entries(evaluatorRevisionIds)) {
        revisionIdToSlug[revId] = slug
    }

    // Create invoke + evaluate functions
    const invoke = createOnboardingInvoke(callAgent)
    const evaluate = createOnboardingEvaluate(callJudge, revisionIdToSlug)

    // Run the evaluation
    console.log("  🚀 Running local evaluation...")
    const result = await runLocalEvaluation(ag, {
        name: name ?? `Onboarding Eval — ${new Date().toISOString().slice(0, 16)}`,
        testsetRevisionId,
        appRevisionId,
        evaluatorRevisionIds: Object.values(evaluatorRevisionIds),
        invoke,
        evaluate,
        onProgress: (completed, total) => {
            console.log(`     [${completed}/${total}] scenarios complete`)
        },
    })

    // Summary
    console.log("\n" + "─".repeat(50))
    console.log(`✅ Evaluation complete: ${result.evaluationId}`)
    console.log(`   Scenarios: ${result.scenarioCount}`)
    console.log(`   Results:   ${result.resultCount}`)
    console.log(`   Errors:    ${result.hasErrors ? result.errors.length : "none"}`)
    if (result.errors.length > 0) {
        for (const err of result.errors) {
            console.log(`     ⚠ Scenario ${err.scenarioIndex} [${err.step}]: ${err.error}`)
        }
    }
    console.log("─".repeat(50) + "\n")

    return {...result, evaluatorRevisionIds}
}
