import { useSyncExternalStore } from "react";
import { BaseEdge, getBezierPath, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { TopoEdge as TopoEdgeT } from "./flowTypes";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Live-updating read of the OS/browser "reduce motion" preference. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, () => false);
}

/**
 * Shared edge renderer for both F1 (static topology) and F2 (scenario
 * player): the same component, driven entirely by edge.data. When
 * data.animate is set, a token circle rides the path via SVG
 * <animateMotion>, per the React Flow "AnimatedSVGEdge" pattern; the
 * animation is decorative only, the state that matters lives in React.
 *
 * data.kind picks both the path shape and the default ink: "spine" edges
 * (the primary browser->...->harness request path) use an orthogonal
 * smoothstep so the spine reads as one deliberate route; "secondary" edges
 * (tools, secrets, tracing, relay, MCP-bridge internals, the response/
 * streaming return path) use a bezier arc instead, which both visually
 * marks them as "not the spine" and helps them curve around nodes rather
 * than overlapping the straight spine segments underneath. Secondary edges
 * default to muted/thin and only reach full ink when data.active is set
 * (hover or click of either endpoint node, or the edge itself).
 */
export function TopoEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<TopoEdgeT>) {
  const isSpine = (data?.kind ?? "spine") === "spine";
  const [path] = isSpine
    ? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 10 })
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.32 });

  const spotlit = data?.spotlit ?? false;
  const dimmed = data?.dimmed ?? false;
  const active = data?.active ?? false;
  const reducedMotion = usePrefersReducedMotion();

  let stroke = "var(--color-text-muted)";
  let strokeWidth = 2.25;
  let opacity = 1;
  let strokeDasharray: string | undefined;

  if (!isSpine) {
    stroke = "var(--color-border-strong)";
    strokeWidth = active ? 1.75 : 1.25;
    opacity = active ? 0.95 : 0.4;
    strokeDasharray = active ? undefined : "3 3";
  }

  if (spotlit) {
    stroke = "var(--color-accent)";
    strokeWidth = 2.75;
    opacity = 1;
    strokeDasharray = undefined;
  }
  if (dimmed) {
    opacity = Math.min(opacity, 0.15);
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray,
          opacity,
          transition: "opacity 150ms ease, stroke 150ms ease, stroke-width 150ms ease",
        }}
      />
      {data?.animate && reducedMotion && (
        <circle
          cx={(sourceX + targetX) / 2}
          cy={(sourceY + targetY) / 2}
          r="5"
          fill="var(--color-accent)"
          stroke="var(--color-bg-raised)"
          strokeWidth="1.5"
        />
      )}
      {data?.animate && !reducedMotion && (
        <circle r="5" fill="var(--color-accent)" stroke="var(--color-bg-raised)" strokeWidth="1.5">
          <animateMotion dur="1.4s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  );
}
