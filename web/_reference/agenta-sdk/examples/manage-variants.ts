/**
 * Example: manage variants programmatically.
 *
 * Demonstrates the full git-style lifecycle:
 * 1. Push a new prompt application (create or update)
 * 2. Commit a revision with updated parameters
 * 3. Deploy the new revision to production
 * 4. Archive a stale variant when it's superseded
 *
 * This is the TS analog of Python's `ag.AppManager.create` +
 * `ag.VariantManager.commit` + `ag.DeploymentManager.deploy` +
 * `ag.VariantManager.delete`.
 *
 * Run:
 *   AGENTA_API_KEY=sk-... AGENTA_PROJECT_ID=... pnpm tsx examples/manage-variants.ts
 */

import {Agenta, AgentaApiError} from "../src/index"

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

    const SLUG = process.env.APP_SLUG ?? "example-support-bot"
    const ENV = process.env.APP_ENV ?? "development"

    // ─── 1. Push a new prompt application ───────────────────────────────────
    //
    // `prompts.push` is the high-level entry point. It creates the application
    // if it doesn't exist, updates it if it does, and deploys to the env in
    // one call. Idempotent — safe to re-run.

    console.log(`[1/4] Pushing prompt "${SLUG}" to env "${ENV}"…`)
    const pushResult = await ag.prompts.push({
        slug: SLUG,
        name: "Example Support Bot",
        description: "Demo prompt managed via the TS SDK",
        content: "You are a helpful, concise customer support agent.",
        environment: ENV,
        model: "openai/gpt-4o-mini",
    })
    console.log("    application_id:", pushResult.applicationId)
    console.log("    revision_id:   ", pushResult.revisionId)
    console.log("    deployed:      ", pushResult.deployed)

    // ─── 2. Commit a new revision with tweaked parameters ────────────────────
    //
    // For finer control than `push`, use the underlying Revisions resource.
    // This commits a new revision tied to the same application/variant.

    console.log(`\n[2/4] Committing a refined revision…`)
    const refinedRevision = await ag.revisions.commit({
        application_id: pushResult.applicationId,
        data: {
            parameters: {
                prompt: {
                    messages: [
                        {
                            role: "system",
                            content:
                                "You are a helpful, concise customer support agent. Always cite sources.",
                        },
                    ],
                    template_format: "curly",
                    input_keys: [],
                    llm_config: {model: "openai/gpt-4o-mini"},
                },
            },
        },
        message: "Refine: require source citations",
    })
    console.log(
        "    new revision_id:",
        refinedRevision.application_revision?.id ?? "(missing)",
    )

    // ─── 3. Look up the revision history ─────────────────────────────────────

    console.log(`\n[3/4] Fetching revision log…`)
    const history = await ag.revisions.log({
        applicationId: pushResult.applicationId,
        depth: 5,
    })
    console.log(`    Found ${history.application_revisions?.length ?? 0} revisions`)
    for (const rev of history.application_revisions ?? []) {
        console.log(`      - ${rev.id} : ${rev.message ?? "(no message)"}`)
    }

    // ─── 4. Soft-delete (archive) the variant when it's no longer needed ─────
    //
    // Mirrors Python's `ag.VariantManager.delete()`. Archives the variant
    // (keeps history) rather than hard-deleting.

    if (process.env.SHOULD_ARCHIVE === "true") {
        const variantId = pushResult.revisionId // the variant id is on the response
        if (variantId) {
            console.log(`\n[4/4] Archiving variant ${variantId}…`)
            try {
                await ag.applications.archiveVariant(variantId)
                console.log("    archived.")
            } catch (err) {
                if (err instanceof AgentaApiError) {
                    console.error(
                        "    archive failed:",
                        err.status,
                        err.detail,
                    )
                } else {
                    throw err
                }
            }
        }
    } else {
        console.log(
            `\n[4/4] Skipping archive (set SHOULD_ARCHIVE=true to demonstrate).`,
        )
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
