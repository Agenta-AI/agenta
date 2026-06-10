import {Tabs} from "antd"

import {PrettyJsonView} from "@/oss/components/DrillInView/PrettyJsonView"

const mockJsonData = {
    trace_id: "tr-98f5a2b1",
    name: "agent_call",
    status: "success",
    inputs: {
        user_query: "Explain how quantum computing works in simple terms with an example.",
        history: [
            {
                role: "user",
                content: "Hi there!",
            },
            {
                role: "assistant",
                content: "Hello! How can I help you today?",
            },
        ],
        context: {
            session_id: "sess-9083812",
            user_profile: {
                name: "Alex Smith",
                preferences: {
                    difficulty: "beginner",
                    tone: "casual",
                },
            },
        },
    },
    parameters: {
        temperature: 0.3,
        max_tokens: 500,
        system_prompt: "You are a friendly teacher. Explain complex topics using simple analogies.",
        model_config: {
            provider: "openai",
            model: "gpt-4o-mini",
            api_version: "2024-02-15-preview",
            hyperparameters: {
                top_p: 0.95,
                presence_penalty: 0,
                frequency_penalty: 0.1,
            },
        },
    },
    intermediate_steps: {
        search_queries: ["quantum computing basics", "quantum computing analogy for kids"],
        search_results: {
            count: 2,
            items: [
                {
                    title: "Quantum Computing for Everyone",
                    snippet:
                        "Quantum computing is a rapidly-emerging technology that harnesses the laws of quantum mechanics to solve problems too complex for classical computers.",
                    url: "https://example.com/quantum",
                },
                {
                    title: "Quantum Physics Simply Explained",
                    snippet:
                        "A beginner-friendly guide to qubits, superposition, entanglement, and how quantum computers calculate values.",
                    url: "https://example.com/quantum-physics",
                },
            ],
        },
        thought_process: {
            step_1: "Analyze user query and identify key requirements (simple terms, analogy, example).",
            step_2: "Retrieve background information on quantum mechanics and qubits.",
            step_3: "Formulate the coin spinning analogy for superposition.",
            step_4: "Formulate the connected dice analogy for entanglement.",
            step_5: "Draft explanation and refine language to match beginner difficulty.",
        },
    },
    outputs: {
        response:
            "Imagine a classical computer is like a light switch: it can only be off (0) or on (1). A quantum computer is like a spinning coin: while it is spinning, it is a bit of both off and on at the same time. This is called superposition, and it allows quantum computers to look at millions of possibilities all at once to solve incredibly complex problems very fast.",
    },
    metadata: {
        latency_seconds: 1.42,
        tokens: {
            prompt_tokens: 150,
            completion_tokens: 240,
            total_tokens: 390,
        },
    },
}

export default function TestPrettyJsonPage() {
    return (
        <div style={{display: "flex", height: "100vh", background: "#f0f2f5"}}>
            {/* Left side: placeholder simulation of main dashboard */}
            <div style={{flex: 1, padding: "24px"}}>
                <h1>Agenta Observability Dashboard (Simulation)</h1>
                <p>Click a trace to open details. Below is the trace drawer preview.</p>
            </div>

            {/* Right side: simulation of Trace Drawer */}
            <div
                style={{
                    width: "600px",
                    background: "#ffffff",
                    borderLeft: "1px solid #d9d9d9",
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                }}
            >
                <div style={{padding: "16px", borderBottom: "1px solid #f0f0f0"}}>
                    <h2 style={{margin: 0}}>Trace: agent_call</h2>
                </div>

                <div
                    className="flex flex-col h-full [&_.ant-tabs-nav]:!sticky [&_.ant-tabs-nav]:!top-0 [&_.ant-tabs-nav]:!z-30 [&_.ant-tabs-nav]:!bg-[var(--ag-c-FFFFFF)]"
                    style={{flex: 1, overflow: "hidden", display: "flex", flexDirection: "column"}}
                >
                    <Tabs
                        defaultActiveKey="raw"
                        style={{height: "100%", display: "flex", flexDirection: "column"}}
                        className="flex flex-col h-full"
                        items={[
                            {
                                key: "overview",
                                label: "Overview",
                                children: <div style={{padding: "16px"}}>Overview Content</div>,
                            },
                            {
                                key: "raw",
                                label: "Raw Data",
                                children: (
                                    <div
                                        style={{
                                            height: "calc(100vh - 120px)",
                                            overflowY: "auto",
                                            padding: "16px",
                                        }}
                                    >
                                        <PrettyJsonView
                                            data={mockJsonData}
                                            keyPrefix="mock-trace-span"
                                            stickyOffset={0}
                                        />
                                    </div>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>
        </div>
    )
}
