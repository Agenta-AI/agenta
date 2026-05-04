import Head from "next/head"

import {DrawerSurface} from "@/mockups/components/DrawerSurface"
import {MockupPageShell} from "@/mockups/components/MockupPageShell"
import {StubDrillIn} from "@/mockups/components/StubDrillIn"
import {StubMoleculeDrillIn} from "@/mockups/components/StubMoleculeDrillIn"
import {fixture08_dot_key_collision} from "@/mockups/data/stubTestcases"

const vanuatu = fixture08_dot_key_collision.find((tc) => tc.id === "tc-08-vanuatu")!

export default function MoleculeDrillInPage() {
    return (
        <>
            <Head>
                <title>Drill-in tier comparison · Design mockups</title>
            </Head>
            <MockupPageShell
                title="Tier 3 (OSS) vs Tier 2 (package) drill-in — same testcase"
                blurb={
                    "The drill-in lives in three tiers; the OSS app uses the heaviest one. This page mounts the same Vanuatu testcase (fixture 08, the dot-key collision case) through both pipelines so we can see the architectural difference and decide which to anchor proposals on."
                }
                notes={
                    <>
                        <strong>What you're looking at:</strong>
                        <br />
                        <strong>Left (Tier 3, OSS):</strong> the 1581-line{" "}
                        <code>DrillInContent</code> from{" "}
                        <code>web/oss/src/components/DrillInView/</code>. Fixed
                        rendering pipeline (no DI), bakes in <code>ChatMessageEditor</code>,{" "}
                        <code>SharedEditor</code>, view-mode selector. Used by 6+ OSS
                        surfaces today.
                        <br />
                        <strong>Right (Tier 1+2, package):</strong> the 798-line{" "}
                        <code>DrillInContent</code> from{" "}
                        <code>web/packages/agenta-ui/src/drill-in/core/</code>, mounted via{" "}
                        <code>MoleculeDrillInView</code> from{" "}
                        <code>@agenta/entity-ui/drill-in</code>. Dependency-injected
                        renderers, slot-based composition, schema-aware. The default{" "}
                        <code>FieldRenderer</code> is a simple JSON <code>&lt;pre&gt;</code> —
                        you'll see plainer output because we haven't injected richer
                        renderers (intentional, to demonstrate the framework's bare API).
                        <br />
                        <br />
                        <strong>Where the chip system from gap-01 lands:</strong> on the
                        package side, as a slot override on{" "}
                        <code>DrillInSlots.fieldHeader</code> (
                        <code>FieldHeaderSlotProps</code>). On the OSS side, as a direct
                        patch to <code>DrillInFieldHeader.tsx:209</code>. Both are needed
                        until the OSS app migrates to the package pipeline.
                    </>
                }
            >
                <div style={styles.split}>
                    <section style={styles.column}>
                        <header style={styles.colHeader}>
                            <h2 style={styles.colTitle}>Tier 3 — OSS DrillInContent</h2>
                            <span style={styles.colMeta}>
                                web/oss/src/components/DrillInView/DrillInContent.tsx
                                <br />
                                1581 lines · monolithic · no DI
                            </span>
                        </header>
                        <DrawerSurface
                            title={`Testcase · ${vanuatu.label}`}
                        >
                            <StubDrillIn
                                initialData={vanuatu.data}
                                rootTitle={vanuatu.label}
                                editable
                                showFieldDrillIn
                                showFieldCollapse
                                enableFieldViewModes
                            />
                        </DrawerSurface>
                    </section>

                    <section style={styles.column}>
                        <header style={styles.colHeader}>
                            <h2 style={styles.colTitle}>Tier 1+2 — Package MoleculeDrillInView</h2>
                            <span style={styles.colMeta}>
                                web/packages/agenta-ui/src/drill-in/core/DrillInContent.tsx
                                <br />
                                798 lines · DI · slot-based · schema-aware
                            </span>
                        </header>
                        <DrawerSurface
                            title={`Testcase · ${vanuatu.label}`}
                        >
                            <StubMoleculeDrillIn
                                entityId={vanuatu.id}
                                initialData={vanuatu.data}
                                rootTitle={vanuatu.label}
                                editable
                            />
                        </DrawerSurface>
                    </section>
                </div>

                <section style={styles.diff}>
                    <h2 style={styles.diffTitle}>Props divergence (concrete)</h2>
                    <div style={styles.diffGrid}>
                        <div style={styles.diffCol}>
                            <h3 style={styles.diffH3}>OSS-only props</h3>
                            <p style={styles.diffNote}>
                                Declared and wired into render — but{" "}
                                <strong>no external callers</strong> in the OSS codebase
                                today. Likely future-feature scaffolding or in-flight
                                refactor.
                            </p>
                            <ul style={styles.diffList}>
                                <li>
                                    <code>toolbarContent</code> — slot in breadcrumb toolbar
                                </li>
                                <li>
                                    <code>hideRootBreadcrumb</code> — hide breadcrumb when at
                                    root
                                </li>
                                <li>
                                    <code>renderExternalControls</code> — render
                                    breadcrumb/add controls externally
                                </li>
                            </ul>
                        </div>

                        <div style={styles.diffCol}>
                            <h3 style={styles.diffH3}>Package-only props</h3>
                            <p style={styles.diffNote}>
                                Real capability the OSS copy lacks. These are the
                                features that argue for migrating consumers to the package
                                tier eventually.
                            </p>
                            <ul style={styles.diffList}>
                                <li>
                                    <code>getSchemaAtPath</code> — schema-aware drilling
                                    (used by molecule controllers in{" "}
                                    <code>createEntityController.ts:305</code>)
                                </li>
                                <li>
                                    <code>currentPath</code> — controlled-mode path state
                                </li>
                                <li>
                                    <code>getFieldViewModeOptions</code> — schema-driven view
                                    mode options
                                </li>
                                <li>
                                    <code>getDefaultFieldViewMode</code> — schema-driven
                                    default mode
                                </li>
                                <li>
                                    <code>FieldRenderer</code> / <code>SchemaRenderer</code> /{" "}
                                    <code>showMessage</code> / <code>ContextProvider</code> —
                                    DI hooks
                                </li>
                            </ul>
                        </div>
                    </div>

                    <div style={styles.diffNoteRow}>
                        <strong>Visible label divergence:</strong> the OSS panel
                        renders raw key names (<code>country</code>,{" "}
                        <code>geo.region</code>); the package panel applies a
                        title-case transform (<code>Country</code>, <code>Geo.region</code>).
                        Cosmetic but worth noting for any UX proposal that depends on
                        verbatim key labelling — gap-05's literal-vs-nested
                        disambiguation, for instance, depends on the user seeing
                        quoted vs. unquoted keys, and a title-case transform
                        muddies that signal.
                    </div>
                </section>
            </MockupPageShell>
        </>
    )
}

const styles = {
    split: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 16,
        marginBottom: 24,
    },
    column: {
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 6,
        padding: 12,
        display: "flex",
        flexDirection: "column" as const,
    },
    colHeader: {
        marginBottom: 12,
        display: "flex",
        flexDirection: "column" as const,
        gap: 2,
    },
    colTitle: {fontSize: 13, fontWeight: 600, margin: 0, color: "#051729"},
    colMeta: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.5)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        lineHeight: 1.6,
    },
    canvas: {
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 4,
        padding: 8,
        flex: 1,
        minHeight: 320,
    },
    diff: {
        marginTop: 16,
        padding: 16,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 6,
    },
    diffTitle: {fontSize: 14, fontWeight: 700, margin: "0 0 12px"},
    diffGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 16,
    },
    diffCol: {fontSize: 12, color: "#051729"},
    diffH3: {fontSize: 12, fontWeight: 600, margin: "0 0 4px"},
    diffNote: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.65)",
        lineHeight: 1.6,
        margin: "0 0 8px",
    },
    diffList: {
        margin: 0,
        paddingLeft: 20,
        lineHeight: 1.8,
    },
    diffNoteRow: {
        marginTop: 16,
        padding: "10px 12px",
        background: "#fffbe6",
        border: "1px solid #ffe58f",
        borderRadius: 4,
        fontSize: 12,
        lineHeight: 1.6,
        color: "#051729",
    },
}
