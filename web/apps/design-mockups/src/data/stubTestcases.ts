/**
 * Stub testcase data shaped like the BE response. Mirrors the JSON fixtures
 * in `docs/designs/json-string-ux/test-fixtures/` so the mockup pages can
 * demonstrate the gaps with realistic payloads.
 */

export type StubTestcase = {
    id: string
    label: string
    data: Record<string, unknown>
}

/**
 * Showcase fixture for gap-01 — exercises every chip variant at the root
 * level so the proposal demonstrates the full vocabulary.
 *   country   → [str]
 *   age       → [num]
 *   verified  → [bool]
 *   notes     → [null]
 *   languages → [arr]
 *   geo       → [obj]
 *   messages  → [msgs]
 *   metadata  → stringified-JSON-as-string
 */
export const fixture_chip_showcase: StubTestcase[] = [
    {
        id: "tc-chips-kiribati",
        label: "Kiribati · chip showcase",
        data: {
            country: "Kiribati",
            age: 45,
            verified: true,
            notes: null,
            languages: ["en", "gil"],
            geo: {
                region: "Micronesia",
                subregion: "Central Pacific",
                coordinates: {lat: 1.328, lng: 172.977},
            },
            messages: [
                {role: "system", content: "You are a geography assistant."},
                {role: "user", content: "What is the capital of Kiribati?"},
                {
                    role: "assistant",
                    content: "The capital of Kiribati is South Tarawa.",
                },
            ],
            metadata:
                '{"source":"trace","trace_id":"abc123","latency_ms":420}',
        },
    },
]

/**
 * Long-form markdown fixture — added 2026-05-04 to exercise the
 * production Lexical-based markdown editor across all three playground
 * execution-item alternatives (Today / Proposed embedded / Alt compact).
 *
 * Contains: a multi-paragraph article-style `prompt` with headings, bold,
 * italic, an ordered list, an inline code span, and a fenced code block;
 * a shorter `system_persona` markdown blurb; a `notes` plain string for
 * contrast.
 */
export const fixture_markdown_article: StubTestcase[] = [
    {
        id: "tc-markdown-article",
        label: "Markdown article",
        data: {
            title: "Capital of Kiribati",
            prompt: `# Capital of Kiribati

Kiribati is an **island nation** in the *central Pacific Ocean*, spanning three island groups: the Gilberts, the Phoenix, and the Line Islands.

## Capital

The capital is **South Tarawa**, an atoll located on the western edge of the Gilberts. It is the most populous urban area in the country.

### Quick facts

1. Population: ~64,000 (South Tarawa)
2. Currency: Australian dollar (AUD)
3. Coordinates: approximately \`1.33° N, 172.97° E\`

## Sample query

\`\`\`json
{
  "country": "Kiribati",
  "ask": "capital"
}
\`\`\`

> Note: the *Phoenix* and *Line* island groups are uninhabited or sparsely populated.`,
            system_persona:
                "You are a **geography expert**. Respond with concise, factual answers. Use *italic* for place names and **bold** for country names.",
            notes: "Plain string field for contrast — no markdown intended.",
            temperature: 0.3,
        },
    },
]

export const fixture02_capitals_with_geo: StubTestcase[] = [
    {
        id: "tc-02-tuvalu",
        label: "Tuvalu",
        data: {
            country: "Tuvalu",
            inputs: {
                country: "Tuvalu",
                region: "Oceania",
                population_thousands: 11,
                is_island_nation: true,
            },
            outputs: {
                countryName: "Tuvalu",
                capital: "Funafuti",
                alternative_names: ["Funafuti Atoll"],
                coordinates: {lat: -8.52, lng: 179.2},
                verified: null,
            },
            correct_answer:
                "The capital of Tuvalu is Funafuti, an atoll on the western edge of Polynesia.",
        },
    },
    {
        id: "tc-02-kiribati",
        label: "Kiribati",
        data: {
            country: "Kiribati",
            inputs: {
                country: "Kiribati",
                region: "Oceania",
                population_thousands: 131,
                is_island_nation: true,
            },
            outputs: {
                countryName: "Kiribati",
                capital: "South Tarawa",
                alternative_names: ["Tarawa", "Bairiki"],
                coordinates: {lat: 1.328, lng: 172.977},
                verified: null,
            },
            correct_answer:
                "The capital of Kiribati is South Tarawa, a small atoll located in the central Pacific Ocean approximately 4,000 km southwest of Hawaii.",
        },
    },
]

export const fixture08_dot_key_collision: StubTestcase[] = [
    {
        id: "tc-08-tuvalu",
        label: "Tuvalu (literal-only)",
        data: {
            country: "Tuvalu",
            "geo.region": "Polynesia",
            "geo.subregion": "Western Polynesia",
            correct_answer: "The capital of Tuvalu is Funafuti.",
        },
    },
    {
        id: "tc-08-kiribati",
        label: "Kiribati (nested-only)",
        data: {
            country: "Kiribati",
            geo: {region: "Micronesia", subregion: "Central Pacific"},
            correct_answer: "The capital of Kiribati is South Tarawa.",
        },
    },
    {
        id: "tc-08-vanuatu",
        label: "Vanuatu (collision)",
        data: {
            country: "Vanuatu",
            "geo.region":
                "LITERAL_DOT_VALUE — flat key for vanuatu region, stored as a single string",
            geo: {
                region:
                    "NESTED_PATH_VALUE — value reached via nested traversal of geo.region",
                subregion: "Melanesia",
                coordinates: {lat: -15.376, lng: 166.959},
            },
            correct_answer:
                "The capital of Vanuatu is Port Vila, located on the southern coast of Efate Island in the South Pacific Ocean.",
        },
    },
]

export const fixture06_deeply_nested: StubTestcase[] = [
    {
        id: "tc-06-tuvalu",
        label: "Tuvalu (deeply nested)",
        data: {
            country: "Tuvalu",
            correct_answer:
                "The capital of Tuvalu is Funafuti, a coral atoll situated in the central Pacific Ocean approximately 1,000 km north of Fiji and 4,000 km northeast of Sydney.",
            context: {
                geo: {
                    region: "Polynesia",
                    subregion: "Western Polynesia",
                    coordinates: {lat: -8.52, lng: 179.2, altitude_m: 4.6},
                },
                demographics: {
                    population: 11792,
                    density: 463,
                    languages: ["en", "tvl"],
                },
            },
            answer: {
                primary: {name: "Funafuti", type: "atoll"},
                verification: {
                    source: "UN demographic yearbook",
                    year: 2024,
                    confidence: "high",
                },
            },
        },
    },
]

export const fixture07_messages_and_tools: StubTestcase[] = [
    {
        id: "tc-07-kiribati-tool",
        label: "Kiribati (with tool call)",
        data: {
            inputs: {
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a geography research assistant with access to a country lookup tool. Cite ISO codes when available.",
                    },
                    {
                        role: "user",
                        content:
                            "What is the capital of Kiribati and its ISO 3166-1 alpha-2 code?",
                    },
                    {
                        role: "assistant",
                        content: "",
                        tool_calls: [
                            {
                                id: "call_abc123",
                                type: "function",
                                function: {
                                    name: "lookup_country",
                                    arguments:
                                        '{"country":"Kiribati","include_iso":true}',
                                },
                            },
                        ],
                    },
                    {
                        role: "tool",
                        tool_call_id: "call_abc123",
                        content:
                            '{"capital":"South Tarawa","iso_alpha2":"KI","region":"Oceania"}',
                    },
                    {
                        role: "assistant",
                        content:
                            "The capital of Kiribati is South Tarawa (ISO code: KI), located in Oceania.",
                    },
                ],
            },
            correct_answer:
                "The capital of Kiribati is South Tarawa, located on the Tarawa atoll in the central Pacific Ocean. ISO 3166-1 alpha-2 code: KI.",
        },
    },
]
