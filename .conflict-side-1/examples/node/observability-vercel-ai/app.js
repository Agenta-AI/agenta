// app.js
import "dotenv/config";

import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { trace } from "@opentelemetry/api";

async function generateStory() {
    // The Vercel AI SDK emits OTel spans automatically when experimental_telemetry is enabled.
    // No manual span creation needed — just call generateText as usual.
    const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Write a two-sentence story about a robot learning to paint." },
        ],
        experimental_telemetry: {
            isEnabled: true,
            // functionId becomes the span/trace name in Agenta
            functionId: "generate-story",
            // metadata is recorded as span attributes
            metadata: {
                userId: "user-123",
                environment: "development",
            },
        },
    });

    return result.text;
}

async function main() {
    try {
        console.log("Generating story...");
        const story = await generateStory();
        console.log("\n" + story);

        // Flush all buffered spans before the process exits
        const tracerProvider = trace.getTracerProvider();
        if (tracerProvider && typeof tracerProvider.forceFlush === "function") {
            await tracerProvider.forceFlush();
        }
        console.log("\nTraces exported to Agenta.");
    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}

main();
