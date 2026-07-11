#!/usr/bin/env node
// /// script
// Runs dagre ONCE against nodes.json + edges.json and writes frozen positions
// to src/figures/topology/positions.json. The app never re-runs this at
// runtime; re-run manually (`pnpm layout`) if nodes.json/edges.json change,
// then hand-adjust the output for clarity same as before.
//
// Approach: dagre lays out the MAIN SPINE only (every ungrouped node, plus
// one placeholder box per group). Group-internal children are NOT part of
// the dagre graph at all; they are arranged in a small hand-authored grid
// inside their group's box afterward. Two earlier approaches were tried and
// rejected:
//   1. Making a real spine node (e.g. "runner") a dagre *compound parent*
//      throws inside @dagrejs/dagre 3.0.0 ("Cannot set properties of
//      undefined (setting 'rank')") whenever a real edge terminates on that
//      parent directly, which every grouped node here needs.
//   2. Using dagre's compound-graph feature with synthetic parent ids (so
//      the real node is a leaf child, not the parent) avoids that crash, but
//      dagre ranks children by their OWN edges same as any other node, so a
//      tightly-related cluster (e.g. the tool-relay/permission-plan pair,
//      which also reaches out to agenta-api several ranks to the right)
//      sprawls into a group box spanning most of the diagram's width -- the
//      opposite of the compact "runner sidecar" box the plan calls for.
// A fixed-size grid, placed by dagre as one opaque box among the other
// spine nodes, gives a compact and legible result at the cost of the intra-
// group arrangement being manual rather than algorithmic.
import dagre from "@dagrejs/dagre";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelDir = path.join(__dirname, "..", "src", "model");
const outFile = path.join(__dirname, "..", "src", "figures", "topology", "positions.json");

const nodesModel = JSON.parse(readFileSync(path.join(modelDir, "nodes.json"), "utf8"));
const edgesModel = JSON.parse(readFileSync(path.join(modelDir, "edges.json"), "utf8"));

const LEAF_WIDTH = 190;
const LEAF_HEIGHT = 58;
const GRID_GAP = 18;
const GRID_PADDING = 16;
const GROUP_HEADER = 26;

// nodes.json's flat "runner" tier (9 nodes) and part of the "sandbox" tier
// (pi-extension) render dense and cluttered as flat boxes; nest them inside
// two visual containers instead, per PLAN.md's grouping guidance. `rows` is
// the hand-curated reading order inside each box (this is the one place
// this script's output is opinion, not derived from the model): `null`
// marks a deliberately empty cell. The guiding rule, worked out by
// checking the rendered graph for edges that clip through an unrelated
// node and re-arranging until they didn't: any node with its OWN external
// connection (leaving the group entirely) needs to be the ONLY occupant of
// its row, so that connection's approach/exit at that row's height never
// crosses another node inside the group. Concretely:
// - acp-pi and acp-claude are daemon's two mutually exclusive next hops
//   (not a sequential chain) AND each carries the spine onward to an
//   external harness; each is the rightmost (only) node in its own row so
//   its exit is clear, with acp-claude a row below acp-pi rather than
//   beside it (so daemon's fork doesn't cross acp-pi to reach it -- see the
//   HANDLE_OVERRIDES entry for e-daemon-acp-claude in buildFlow.ts, which
//   makes that edge drop down before jogging right for the same reason).
// - mcp-bridge and tool-relay each have their own external connections
//   (harness-claude in; pi-extension/daytona-sandbox in, agenta-api out);
//   each gets a solo row, stacked in the same column, rather than sharing
//   a row where one's external line would cross the other.
// - permission-plan is a pure sink (no external edges) so it can safely
//   share acp-responder's row; acp-responder still gets the rightmost
//   column for its own external reply edge to harness-claude.
const GROUPS = {
  "grp-runner": {
    label: "Agent Runner Sidecar (in-process)",
    tier: "runner",
    rows: [
      ["runner", "sandbox-agent-daemon", "acp-pi", null],
      ["session-persistence", null, "acp-claude", null],
      [null, null, null, "mcp-bridge"],
      [null, null, null, "tool-relay"],
      [null, null, "permission-plan", "acp-responder"],
    ],
  },
  "grp-pi-harness": {
    label: "Pi CLI process",
    tier: "sandbox",
    rows: [["harness-pi", "pi-extension"]],
  },
};

const childToParent = new Map();
for (const [parentId, group] of Object.entries(GROUPS)) {
  for (const row of group.rows) for (const childId of row) if (childId) childToParent.set(childId, parentId);
}

function gridSize(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const width = GRID_PADDING * 2 + cols * LEAF_WIDTH + (cols - 1) * GRID_GAP;
  const height =
    GROUP_HEADER + GRID_PADDING * 2 + rows.length * LEAF_HEIGHT + (rows.length - 1) * GRID_GAP;
  return { width, height };
}

// ---- Pass 1: dagre lays out the spine (ungrouped nodes + one box per group) ----

const g = new dagre.graphlib.Graph();
g.setDefaultEdgeLabel(() => ({}));
g.setGraph({ rankdir: "LR", nodesep: 90, ranksep: 220, marginx: 40, marginy: 40 });

for (const node of nodesModel.nodes) {
  if (childToParent.has(node.id)) continue; // laid out inside its group's grid instead
  g.setNode(node.id, { width: LEAF_WIDTH, height: LEAF_HEIGHT });
}
for (const [groupId, group] of Object.entries(GROUPS)) {
  g.setNode(groupId, gridSize(group.rows));
}

const seenSpineEdges = new Set();
for (const edge of edgesModel.edges) {
  const v = childToParent.get(edge.from) ?? edge.from;
  const w = childToParent.get(edge.to) ?? edge.to;
  if (v === w) continue; // both ends fall inside the same group: internal, not a spine edge
  const key = `${v}->${w}`;
  if (seenSpineEdges.has(key)) continue;
  seenSpineEdges.add(key);
  g.setEdge(v, w);
}

dagre.layout(g);

// Platform-tier nodes float off the main spine (below/above it) rather than
// sitting inline with whichever tier their edges happen to pull them toward.
const PLATFORM_Y_OFFSET = {
  "agenta-api": 1,
  composio: 1,
  "tracing-pipeline": -1,
  triggers: -1,
};

const nodeTierById = new Map(nodesModel.nodes.map((n) => [n.id, n.tier]));
nodeTierById.set("grp-runner", "runner");
nodeTierById.set("grp-pi-harness", "sandbox");

let spineMinY = Infinity;
let spineMaxY = -Infinity;
for (const id of g.nodes()) {
  if (nodeTierById.get(id) === "platform") continue;
  const n = g.node(id);
  spineMinY = Math.min(spineMinY, n.y - n.height / 2);
  spineMaxY = Math.max(spineMaxY, n.y + n.height / 2);
}

const positions = {};

for (const id of g.nodes()) {
  const n = g.node(id);
  const tier = nodeTierById.get(id);
  let y = n.y;
  if (PLATFORM_Y_OFFSET[id]) {
    y = PLATFORM_Y_OFFSET[id] < 0 ? spineMinY - 160 : spineMaxY + 160;
  }
  positions[id] = {
    x: Math.round(n.x - n.width / 2),
    y: Math.round(y - n.height / 2),
    width: Math.round(n.width),
    height: Math.round(n.height),
    parentId: null,
  };
}

// ---- Pass 2: place each group's children in its hand-authored grid, ----
// ---- positions relative to the group box (React Flow's convention for ----
// ---- any node with a parentId). ----

for (const [groupId, group] of Object.entries(GROUPS)) {
  group.rows.forEach((row, rowIndex) => {
    row.forEach((childId, colIndex) => {
      if (!childId) return; // null: deliberately empty cell, see the GROUPS comment above.
      positions[childId] = {
        x: GRID_PADDING + colIndex * (LEAF_WIDTH + GRID_GAP),
        y: GROUP_HEADER + GRID_PADDING + rowIndex * (LEAF_HEIGHT + GRID_GAP),
        width: LEAF_WIDTH,
        height: LEAF_HEIGHT,
        parentId: groupId,
      };
    });
  });
}

writeFileSync(outFile, JSON.stringify(positions, null, 2) + "\n");
console.log(`Wrote ${Object.keys(positions).length} node positions to ${path.relative(process.cwd(), outFile)}`);
