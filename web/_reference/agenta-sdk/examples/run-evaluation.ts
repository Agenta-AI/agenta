/**
 * Example: run an evaluation programmatically.
 *
 * Demonstrates:
 * 1. Create (or fetch) a testset with inline cases
 * 2. Find an evaluator by slug
 * 3. Find an application revision to evaluate
 * 4. Start a "simple evaluation" linking the three
 * 5. Poll until the evaluation closes, then read the resulting run + scenarios + metrics
 *
 * Uses `evaluations.createSimple` — the high-level API that accepts a flat
 * list of testset/application/evaluator IDs and provisions all the run plumbing
 * underneath. For the lower-level eval surface (custom step graphs, repeats,
 * data mappings), use `evaluations.createRuns` directly.
 *
 * Run:
 *   AGENTA_API_KEY=sk-... AGENTA_PROJECT_ID=... pnpm tsx examples/run-evaluation.ts
 */

import {Agenta, AgentaApiError, AgentaNotFoundError} from "../src/index"

const APP_SLUG = process.env.APP_SLUG ?? "example-support-bot"
const EVALUATOR_SLUG = process.env.EVALUATOR_SLUG ?? "exact-match"
const TESTSET_SLUG = process.env.TESTSET_SLUG ?? "example-support-cases"

async function main() {
    if (!process.env.AGENTA_API_KEY) {
        console.error("Set AGENTA_API_KEY before running this example.")
        process.exit(1)
    }

    const ag = new Agenta({
        host: process.env.AGENTA_HOST ?? "https://cloud.agenta.ai",
        apiKey: process.env.AGENTA_API_KEY,
        projectId: process.env.AGENTA_PROJECT_ID,
    })

    // ─── 1. Ensure a testset exists ─────────────────────────────────────────

    console.log(`[1/5] Locating testset "${TESTSET_SLUG}"…`)
    let testset = await ag.testsets.findBySlug(TESTSET_SLUG)
    if (!testset) {
        console.log("    not found — creating with two cases")
        testset = await ag.testsets.create({
            slug: TESTSET_SLUG,
            name: "Example Support Cases",
            description: "Demo testset for the run-evaluation example",
            testcases: [
                {
                    input: "How do I reset my password?",
                    expected: "Use the forgot-password link on the sign-in page.",
                },
                {
                    input: "What's your refund policy?",
                    expected: "Full refund within 30 days of purchase.",
                },
            ],
        })
    }
    console.log("    testset_id:", testset.id)

    // ─── 2. Find the evaluator ──────────────────────────────────────────────

    console.log(`\n[2/5] Locating evaluator "${EVALUATOR_SLUG}"…`)
    const evaluator = await ag.evaluators.findBySlug(EVALUATOR_SLUG)
    if (!evaluator) {
        console.error(
            `    Evaluator "${EVALUATOR_SLUG}" not found. Create one with ag.evaluators.create({...}) first.`,
        )
        process.exit(1)
    }
    console.log("    evaluator_id:", evaluator.id)

    // ─── 3. Find the application revision to evaluate ───────────────────────

    console.log(`\n[3/5] Locating application revision for "${APP_SLUG}"…`)
    let appRevision
    try {
        appRevision = await ag.revisions.retrieveBySlug(APP_SLUG, {resolve: true})
    } catch (err) {
        if (err instanceof AgentaNotFoundError) {
            console.error(
                `    Application "${APP_SLUG}" not found. Run examples/manage-variants.ts first.`,
            )
            process.exit(1)
        }
        throw err
    }
    if (!appRevision?.id) {
        console.error("    No application revision found.")
        process.exit(1)
    }
    console.log("    revision_id:", appRevision.id)

    // ─── 4. Start a simple evaluation ───────────────────────────────────────

    console.log(`\n[4/5] Starting evaluation…`)
    const created = await ag.evaluations.createSimple({
        name: `Eval ${TESTSET_SLUG} → ${APP_SLUG} (${new Date().toISOString()})`,
        description: "Started by examples/run-evaluation.ts",
        data: {
            testset_steps: [testset.id!],
            application_steps: [appRevision.id],
            evaluator_steps: evaluator.revision_id ? [evaluator.revision_id] : [evaluator.id!],
        },
    })
    const evaluation = created.evaluation
    if (!evaluation?.id) {
        console.error("    createSimple returned no evaluation id:", created)
        process.exit(1)
    }
    console.log("    evaluation_id:", evaluation.id)

    // The simple-evaluation API needs an explicit start call to begin processing.
    await ag.evaluations.startSimple(evaluation.id)
    console.log("    started.")

    // ─── 5. Poll for completion + read results ──────────────────────────────

    console.log(`\n[5/5] Polling evaluation status…`)
    const start = Date.now()
    const TIMEOUT_MS = 5 * 60_000
    while (true) {
        const fresh = await ag.evaluations.getSimple(evaluation.id)
        // Status lives on `data.status` for simple evaluations, not the top level.
        const status = fresh.evaluation?.data?.status as string | undefined
        process.stdout.write(
            `    status=${status ?? "?"} (${Math.round((Date.now() - start) / 1000)}s)\r`,
        )
        if (status === "closed" || status === "errored" || status === "completed") {
            console.log("\n    final status:", status)
            break
        }
        if (Date.now() - start > TIMEOUT_MS) {
            console.log("\n    timed out after 5 minutes; stopping run")
            await ag.evaluations.stopSimple(evaluation.id)
            break
        }
        await new Promise((r) => setTimeout(r, 3000))
    }

    // The simple evaluation creates one run under the hood. Look it up by name
    // (or via the evaluation's data field), then read its scenarios/results/metrics.
    const runs = await ag.evaluations.queryRuns({
        run: {ids: undefined, references: [{evaluation: {id: evaluation.id}}]},
    })
    const run = runs.runs?.[0]
    if (!run?.id) {
        console.log("\n(No run found for this evaluation — skipping detail dump.)")
        return
    }

    const scenarios = await ag.evaluations.queryScenarios({scenario: {run_ids: [run.id]}})
    console.log(`\nScenarios: ${scenarios.scenarios?.length ?? 0}`)

    const results = await ag.evaluations.queryResults({result: {run_ids: [run.id]}})
    console.log(`Results:   ${results.results?.length ?? 0}`)

    const metrics = await ag.evaluations.queryMetrics({metrics: {run_ids: [run.id]}})
    console.log(`Metrics:   ${metrics.metrics?.length ?? 0}`)
    for (const m of metrics.metrics ?? []) {
        console.log(`  - run=${m.run_id} scenario=${m.scenario_id ?? "(aggregate)"}: status=${m.status ?? "?"}`)
    }

    console.log("\nDone.")
}

main().catch((err) => {
    if (err instanceof AgentaApiError) {
        console.error("Agenta API error:", err.status, err.detail)
    } else {
        console.error("Unexpected error:", err)
    }
    process.exit(1)
})
