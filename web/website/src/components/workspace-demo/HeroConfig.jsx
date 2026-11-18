import { useState } from "react";
import { CaretDoubleRight } from "@phosphor-icons/react";
import PlaygroundSettings from "./PlaygroundSettings.jsx";

// The hero's animated session shows the same configuration pane as the demo.
export default function HeroConfig({ agent }) {
  const [open, setOpen] = useState(true);
  const setSplit = (node, value) =>
    node?.closest(".ws-split")?.setAttribute("data-config", String(value));
  return open ? (
    <PlaygroundSettings
      agent={agent}
      onHide={(event) => {
        setSplit(event?.currentTarget, false);
        setOpen(false);
      }}
    />
  ) : (
    <button
      type="button"
      className="ws-cfg-show"
      aria-label="Show configuration"
      onClick={(event) => {
        setSplit(event.currentTarget, true);
        setOpen(true);
      }}
    >
      <CaretDoubleRight size={14} aria-hidden="true" />
    </button>
  );
}
