import { useEffect, useRef, useState, type CSSProperties } from "react";

/*
 * HostingToggle — a small React island (client:visible) for the pricing page.
 *
 * The pricing page server-renders BOTH the cloud plans and the self-hosted plans,
 * then hides the inactive set with CSS keyed off a `data-hosting` attribute on the
 * page root (`#pricing-root`). This island just flips that attribute, so the page
 * is fully correct before hydration / without JS (default = cloud).
 *
 * Accessibility: rendered as a 2-option radiogroup. Arrow/Home/End keys move and
 * select; only the selected radio is in the tab order (roving tabindex).
 */

type Mode = "cloud" | "selfHosted";

interface Option {
  mode: Mode;
  label: string;
  sublabel?: string;
}

interface Props {
  targetId?: string;
  defaultMode?: Mode;
  options: Option[];
}

// #pricing-root reads the lowercased mode; keep this the single source of that mapping.
const attrValue = (mode: Mode) => (mode === "selfHosted" ? "selfhosted" : "cloud");

export default function HostingToggle({
  targetId = "pricing-root",
  defaultMode = "cloud",
  options,
}: Props) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Reflect the selected mode onto the page root so the CSS shows/hides plan sets.
  useEffect(() => {
    document.getElementById(targetId)?.setAttribute("data-hosting", attrValue(mode));
  }, [mode, targetId]);

  const selectIndex = (index: number) => {
    const next = options[index];
    if (!next) return;
    setMode(next.mode);
    refs.current[index]?.focus();
  };

  const current = options.findIndex((o) => o.mode === mode);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectIndex((current + 1) % options.length);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectIndex((current - 1 + options.length) % options.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      selectIndex(options.length - 1);
    }
  };

  const tabBase: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 34,
    padding: "0 18px",
    borderRadius: 9,
    font: "var(--text-label)",
    cursor: "pointer",
    border: "none",
    background: "transparent",
    transition: "all 0.14s",
  };
  // Colors resolve through the --ht-* vars defined in pricing.astro's global
  // style block (light per the light-theme spec, dark = the old literals).
  const on: CSSProperties = {
    ...tabBase,
    background: "var(--ht-on-bg)",
    boxShadow: "var(--ht-on-ring)",
    color: "var(--ht-on-text)",
  };
  const off: CSSProperties = { ...tabBase, color: "var(--ht-off-text)" };

  return (
    <div
      role="radiogroup"
      aria-label="Hosting"
      className="hosting-toggle"
      onKeyDown={onKeyDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: 5,
        borderRadius: 12,
        background: "var(--ht-bg)",
        boxShadow: "var(--ht-ring)",
      }}
    >
      {options.map((option, index) => {
        const selected = option.mode === mode;
        return (
          <button
            key={option.mode}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => selectIndex(index)}
            className="hosting-tab"
            style={selected ? on : off}
          >
            <span className="hosting-tab-label">{option.label}</span>
            {option.sublabel && (
              <span
                className="hosting-tab-sub"
                style={{
                  font: "var(--text-caption)",
                  color: "var(--ht-sub-text)",
                }}
              >
                {option.sublabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
