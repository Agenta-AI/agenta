import { useEffect, useRef, useState } from "react";
import {
  Headset,
  PenNib,
  Target,
  ChartLineUp,
  Receipt,
  Lightning,
  Robot,
} from "./ph.jsx";

export const cx = (...c) => c.filter(Boolean).join(" ");

const GLYPHS = {
  headset: Headset,
  pen: PenNib,
  target: Target,
  chart: ChartLineUp,
  receipt: Receipt,
};

/** The agent chip: the solid colour on its tint, as agentIconChrome draws it. */
export function AgentChip({ agent, size = 32, radius = 8, glyph = 16 }) {
  const G = GLYPHS[agent.icon] ?? Robot;
  return (
    <span
      className="hx-chip"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: agent.color[1],
        color: agent.color[0],
      }}
    >
      <G size={glyph} weight="regular" />
    </span>
  );
}

/** Session run state, as the rail draws it (useMobileNavItems getIcon). */
export function Bullet({ status }) {
  if (status === "auto") return <Lightning size={12} className="hx-autobul" />;
  return (
    <span
      className={cx(
        "bul",
        status === "live" && "live",
        status === "waiting" && "wait",
      )}
    />
  );
}

/** A trigger plus a menu that closes on an outside click or Escape. */
export function Pop({ trigger, children, className, menuClass, align }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <span className={cx("pw", className)} ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open ? (
        <div
          className={cx("menu", align === "right" && "r", menuClass)}
          role="menu"
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </span>
  );
}

/** One menu row. */
export const Mi = ({ children, onClick, cur, end, icon }) => (
  <button
    type="button"
    className={cx("mi", cur && "cur")}
    role="menuitem"
    onClick={onClick}
  >
    {icon}
    <span className="cut grow">{children}</span>
    {end ? <span className="end">{end}</span> : null}
  </button>
);

/** Icon button (28px, or 32px in the session strip). */
export const Ib = ({
  label,
  on,
  onClick,
  children,
  className,
  style,
  disabled,
}) => (
  <button
    type="button"
    className={cx("ib", on && "on", className)}
    aria-label={label}
    title={label}
    aria-pressed={on === undefined ? undefined : !!on}
    onClick={onClick}
    style={style}
    disabled={disabled}
  >
    {children}
  </button>
);

/** The switch from @agenta/ui (28x16 track). */
export const Switch = ({ on, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={!!on}
    aria-label={label}
    className={cx("hx-switch", on && "on")}
    onClick={() => onChange(!on)}
  >
    <i />
  </button>
);

export const Avatar = ({ initials, size = 24, tone }) => (
  <span
    className={cx("hx-avatar", tone)}
    style={{ width: size, height: size, fontSize: size <= 24 ? 10 : 11 }}
  >
    {initials}
  </span>
);

export const initialsOf = (name) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

/** An app logo from the catalog (public/logos/apps), with a letter tile if the file is missing. */
export function AppLogo({ slug, name, size = 20 }) {
  const [failed, setFailed] = useState(false);
  if (failed || !slug)
    return (
      <span className="hx-applogo-fb" style={{ width: size, height: size }}>
        {name[0]}
      </span>
    );
  return (
    <img
      className="hx-applogo"
      src={`/logos/apps/${slug}.svg`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}
