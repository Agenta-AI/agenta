import {useState} from "react"

import dynamic from "next/dynamic"

const Editor = dynamic(() => import("@agenta/ui/editor").then((module) => module.Editor), {
    ssr: false,
})

/**
 * Same validation contract used by playground schema editor controls
 * (see TOOL_SCHEMA in agenta-entity-ui ToolItemControl).
 */
const PLAYGROUND_SCHEMA_EDITOR_VALIDATION_SCHEMA = {
    type: "object",
    properties: {
        type: {type: "string", enum: ["function"]},
        function: {
            type: "object",
            properties: {
                name: {type: "string"},
                description: {type: "string"},
                parameters: {
                    type: "object",
                    properties: {
                        type: {type: "string", enum: ["object"]},
                        properties: {
                            type: "object",
                            additionalProperties: {
                                type: "object",
                                properties: {
                                    type: {type: "string"},
                                    description: {type: "string"},
                                },
                                required: ["type"],
                            },
                        },
                        required: {type: "array", items: {type: "string"}},
                        additionalProperties: {type: "boolean"},
                    },
                    required: ["type", "properties", "required", "additionalProperties"],
                },
            },
            required: ["name", "description", "parameters"],
        },
    },
    required: ["type", "function"],
} as const

function buildLargeToolSchemaSample() {
    const rootProperties: Record<string, Record<string, unknown>> = {
        metadata: {
            type: "object",
            description: "Document metadata",
            properties: {
                schema_version: {type: "string", description: "Schema version"},
                owner: {type: "string", description: "Owning team"},
                last_updated_epoch_ms: {
                    type: "number",
                    description: "Last update timestamp in ms",
                },
            },
            required: ["schema_version", "owner"],
            additionalProperties: false,
        },
    }
    const rootRequired: string[] = ["metadata"]

    const sectionCount = 24
    const fieldsPerSection = 18

    for (let section = 1; section <= sectionCount; section++) {
        const sectionProperties: Record<string, Record<string, unknown>> = {}
        const sectionRequired: string[] = []

        for (let field = 1; field <= fieldsPerSection; field++) {
            const fieldKey = `field_${section}_${field}`
            const typeSelector = (section + field) % 5

            if (typeSelector === 0) {
                sectionProperties[fieldKey] = {
                    type: "string",
                    description: `String field ${fieldKey}`,
                    minLength: 1,
                }
            } else if (typeSelector === 1) {
                sectionProperties[fieldKey] = {
                    type: "number",
                    description: `Numeric field ${fieldKey}`,
                    minimum: 0,
                    maximum: 1000000,
                }
            } else if (typeSelector === 2) {
                sectionProperties[fieldKey] = {
                    type: "boolean",
                    description: `Boolean flag ${fieldKey}`,
                }
            } else if (typeSelector === 3) {
                sectionProperties[fieldKey] = {
                    type: "array",
                    description: `Array field ${fieldKey}`,
                    items: {
                        type: "object",
                        properties: {
                            id: {type: "string", description: "Array item id"},
                            score: {type: "number", description: "Array item score"},
                        },
                        required: ["id"],
                        additionalProperties: false,
                    },
                }
            } else {
                sectionProperties[fieldKey] = {
                    type: "object",
                    description: `Nested object field ${fieldKey}`,
                    properties: {
                        enabled: {type: "boolean", description: "Enabled flag"},
                        mode: {type: "string", description: "Operation mode"},
                        threshold: {type: "number", description: "Threshold value"},
                    },
                    required: ["enabled"],
                    additionalProperties: false,
                }
            }

            if (field % 3 === 0) {
                sectionRequired.push(fieldKey)
            }
        }

        const sectionKey = `section_${section}`
        rootProperties[sectionKey] = {
            type: "object",
            description: `Large nested section ${section}`,
            properties: sectionProperties,
            required: sectionRequired,
            additionalProperties: false,
        }

        if (section % 2 === 0) {
            rootRequired.push(sectionKey)
        }
    }

    return {
        type: "function",
        function: {
            name: "validate_large_payload",
            description: "Large schema payload for Lexical editor performance/validation testing",
            parameters: {
                type: "object",
                properties: rootProperties,
                required: rootRequired,
                additionalProperties: false,
            },
        },
    }
}

const INITIAL_EDITOR_CONTENT = JSON.stringify(buildLargeToolSchemaSample(), null, 2)

export default function EditorTestPage() {
    const [lastDrillInPath, setLastDrillInPath] = useState<string | null>(null)

    return (
        <main className="h-full overflow-auto p-6">
            <div className="mx-auto w-full max-w-[1600px] space-y-3">
                <h1 className="text-lg font-semibold text-[#1C2C3D]">Editor Test</h1>
                <p className="text-sm text-[#637381]">
                    Side-by-side: New @agenta/ui Editor (left) vs Legacy oss/components/Editor
                    (right). Same 24x18 JSON payload.
                </p>
                <div className="flex gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                        <h2 className="text-sm font-medium text-[#1C2C3D]">
                            New Editor (@agenta/ui)
                        </h2>
                        <div className="min-h-[420px]">
                            <Editor
                                id="ee-editor-test-new"
                                codeOnly
                                language="json"
                                initialValue={INITIAL_EDITOR_CONTENT}
                                showToolbar={false}
                                enableResize
                                validationSchema={PLAYGROUND_SCHEMA_EDITOR_VALIDATION_SCHEMA}
                                onPropertyClick={(path) => setLastDrillInPath(path)}
                            />
                        </div>
                    </div>
                    {/* <div className="flex-1 min-w-0 space-y-2">
                        <h2 className="text-sm font-medium text-[#1C2C3D]">
                            Legacy Editor (oss/components/Editor)
                        </h2>
                        <div className="min-h-[420px] max-h-[70vh] overflow-auto">
                            <LegacyEditor
                                id="ee-editor-test-legacy"
                                codeOnly
                                language="json"
                                initialValue={INITIAL_EDITOR_CONTENT}
                                showToolbar={false}
                                enableResize
                                validationSchema={PLAYGROUND_SCHEMA_EDITOR_VALIDATION_SCHEMA}
                                onPropertyClick={(path) => setLastDrillInPath(path)}
                            />
                        </div>
                    </div> */}
                </div>
                <p className="text-xs text-[#637381]">
                    Last drill-in path: {lastDrillInPath ?? "none"}
                </p>
            </div>
        </main>
    )
}
