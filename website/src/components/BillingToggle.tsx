import { useEffect, useRef, useState, type CSSProperties } from "react";

/*
 * BillingToggle — a small React island (client:visible) for the pricing page.
 *
 * The pricing page server-renders BOTH the monthly and annual price for every
 * plan card and comparison-table header, then hides the inactive one with CSS
 * keyed off a `data-billing` attribute on the page root (`#pricing-root`). This
 * island just flips that attribute, so prices switch with no layout work here
 * and the page is fully correct before hydration (default = monthly).
 *
 * Accessibility: rendered as a 2-option radiogroup. Arrow keys move + select;
 * the selected radio is the only one in the tab order (roving tabindex).
 */

type Cycle = "monthly" | "annual";

interface Props {
  targetId?: string;
  defaultCycle?: Cycle;
  annualDiscountLabel?: string;
}

export default function BillingToggle({
  targetId = "pricing-root",
  defaultCycle = "monthly",
  annualDiscountLabel = "−20%",
}: Props) {
  const [cycle, setCycle] = useState<Cycle>(defaultCycle);
  const monthlyRef = useRef<HTMLButtonElement>(null);
  const annualRef = useRef<HTMLButtonElement>(null);

  // Reflect the selected cycle onto the page root so the CSS shows/hides prices.
  useEffect(() => {
    document.getElementById(targetId)?.setAttribute("data-billing", cycle);
  }, [cycle, targetId]);

  const select = (next: Cycle) => {
    setCycle(next);
    (next === "monthly" ? monthlyRef : annualRef).current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      select("annual");
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      select("monthly");
    } else if (e.key === "Home") {
      e.preventDefault();
      select("monthly");
    } else if (e.key === "End") {
      e.preventDefault();
      select("annual");
    }
  };

  const tabBase: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    height: 34,
    padding: "0 18px",
    borderRadius: 9,
    font: "var(--text-label)",
    cursor: "pointer",
    border: "none",
    background: "transparent",
    transition: "all 0.14s",
  };
  const on: CSSProperties = {
    ...tabBase,
    background: "rgba(255,255,255,0.08)",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)",
    color: "#F7F6F4",
  };
  const off: CSSProperties = { ...tabBase, color: "rgba(255,255,255,0.55)" };

  return (
    <div
      role="radiogroup"
      aria-label="Billing cycle"
      onKeyDown={onKeyDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: 5,
        borderRadius: 12,
        background: "rgba(255,255,255,0.04)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
      }}
    >
      <button
        ref={monthlyRef}
        type="button"
        role="radio"
        aria-checked={cycle === "monthly"}
        tabIndex={cycle === "monthly" ? 0 : -1}
        onClick={() => select("monthly")}
        style={cycle === "monthly" ? on : off}
      >
        Monthly
      </button>
      <button
        ref={annualRef}
        type="button"
        role="radio"
        aria-checked={cycle === "annual"}
        tabIndex={cycle === "annual" ? 0 : -1}
        onClick={() => select("annual")}
        style={cycle === "annual" ? on : off}
      >
        Annual
        <span
          style={{
            marginLeft: 7,
            font: "var(--text-caption)",
            color: "var(--yellow-400)",
          }}
        >
          {annualDiscountLabel}
        </span>
      </button>
    </div>
  );
}
