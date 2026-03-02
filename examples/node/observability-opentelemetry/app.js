// app.js
import 'dotenv/config';

import { trace } from "@opentelemetry/api";
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const tracer = trace.getTracer("test-app", "1.0.0");

async function generate() {
    // Create a manual span using Agenta's semantic conventions
    // This demonstrates how to manually instrument functions with proper attributes
    return tracer.startActiveSpan("generate", async (span) => {
        try {
            // Define the messages for the chat completion
            const messages = [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Write a short story about AI Engineering." },
            ];

            // Agenta Semantic Convention: ag.type.node
            // Defines the type of operation (workflow, task, tool, etc.)
            span.setAttribute("ag.type.node", "workflow");

            // Agenta Semantic Convention: ag.data.inputs
            // Stores the input parameters as JSON
            span.setAttribute("ag.data.inputs", JSON.stringify({
                messages: messages,
                model: "gpt-5"
            }));

            const response = await openai.chat.completions.create({
                model: "gpt-5",
                messages: messages,
            });

            const content = response.choices[0].message.content;

            // Agenta Semantic Convention: ag.data.internals
            // Stores intermediate values and metadata (optional)
            span.setAttribute("ag.data.internals", JSON.stringify({
                response_length: content.length
            }));

            // Agenta Semantic Convention: ag.data.outputs
            // Stores the output results as JSON
            span.setAttribute("ag.data.outputs", JSON.stringify({
                content: content
            }));

            return content;
        } finally {
            span.end();
        }
    });
}

async function main() {
    try {
        const result = await generate();
        console.log("\n" + result);

        console.log("\n⏳ Flushing traces...");
        // Ensure traces are flushed before exit
        const tracerProvider = trace.getTracerProvider();
        if (tracerProvider && typeof tracerProvider.forceFlush === 'function') {
            await tracerProvider.forceFlush();
        }
        // Extra wait to ensure export completes
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log("✅ Done!");
    } catch (error) {
        console.error("❌ Error:", error.message);
        process.exit(1);
    }
}

main();

