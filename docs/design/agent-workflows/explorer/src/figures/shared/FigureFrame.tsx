import { useEffect, useRef, useState, type ReactNode } from "react";

export interface FigureFrameProps {
  children: ReactNode;
  className?: string;
}

/**
 * Shared fullscreen wrapper for every figure (F1-F4). Wraps the figure's own
 * root (which keeps its existing "figure-shell" class and internal layout)
 * in a positioned frame that owns one small overlay button using the native
 * Fullscreen API. requestFullscreen()/exitFullscreen() operate on this
 * wrapper element (not the figure-shell child), so styles.css can give the
 * :fullscreen element itself the app background in both color schemes
 * (the browser's default fullscreen backdrop is opaque black, which would
 * otherwise show through any transparent edges of the figure).
 *
 * Deliberately does not know about React Flow: any fitView-on-resize
 * behavior lives in TopologyCanvas's own ResizeObserver, which also fires
 * when this wrapper enters/exits fullscreen (the container's box size
 * changes either way), so nothing here needs to special-case that.
 */
export function FigureFrame({ children, className }: FigureFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onChange() {
      setIsFullscreen(Boolean(document.fullscreenElement) && document.fullscreenElement === ref.current);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void ref.current?.requestFullscreen();
    }
  }

  const classes = ["figure-frame", className].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={classes} data-fullscreen={isFullscreen}>
      <button
        type="button"
        className="figure-fullscreen-btn"
        onClick={toggleFullscreen}
        aria-pressed={isFullscreen}
        aria-label={isFullscreen ? "Exit fullscreen" : "Expand figure to fullscreen"}
        title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
      >
        {isFullscreen ? "⤡" : "⤢"}
      </button>
      {isFullscreen && <div className="figure-fullscreen-hint">Press Esc to exit fullscreen</div>}
      {children}
    </div>
  );
}
