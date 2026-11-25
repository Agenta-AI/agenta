// The "tour" hero: four scripted states of the app mockup, switched with dashes and arrows.
// Each state stays clickable; a click inside the mockup never changes the step.
import { useState } from "react";
import { CaretLeft, CaretRight } from "./ph.jsx";
import HeroApp from "./HeroApp.jsx";

const STEPS = [
  {
    preset: "build",
    title: "Build",
    copy: "Describe the job in plain words. The builder sets up the agent and asks you before it saves a change.",
  },
  {
    preset: "work",
    title: "Work",
    copy: "Open a session, read what the agent did, and check the files it wrote.",
  },
  {
    preset: "deploy",
    title: "Deploy",
    copy: "Connect the agent to Slack, Telegram, WhatsApp, Discord or Teams, or call it from your code.",
  },
  {
    preset: "govern",
    title: "Govern",
    copy: "See what your agents cost, how often they run, and how reliably they finish.",
  },
];

export default function HeroTour() {
  const [step, setStep] = useState(0);
  const go = (n) => setStep((n + STEPS.length) % STEPS.length);
  const cur = STEPS[step];
  const onKey = (e) => {
    if (e.key === "ArrowRight") go(step + 1);
    if (e.key === "ArrowLeft") go(step - 1);
  };
  return (
    <div className="hxt" onKeyDown={onKey}>
      <div className="hxt-dashes" role="tablist" aria-label="Tour steps">
        {STEPS.map((s, i) => (
          <button
            key={s.preset}
            type="button"
            role="tab"
            aria-selected={i === step}
            aria-label={`Step ${i + 1}: ${s.title}`}
            className={i === step ? "on" : ""}
            onClick={() => setStep(i)}
          />
        ))}
      </div>
      <div className="hxt-stage">
        <button
          type="button"
          className="hxt-arrow prev"
          aria-label="Previous step"
          onClick={() => go(step - 1)}
        >
          <CaretLeft size={20} />
        </button>
        <div
          className="hx-frame"
          data-hx-frame
          role="group"
          aria-label={`Agenta app: ${cur.title}`}
        >
          <HeroApp preset={cur.preset} key={cur.preset} />
        </div>
        <button
          type="button"
          className="hxt-arrow next"
          aria-label="Next step"
          onClick={() => go(step + 1)}
        >
          <CaretRight size={20} />
        </button>
      </div>
      <div className="hxt-copy" aria-live="polite">
        <p className="hxt-title">{cur.title}</p>
        <p className="hxt-text">{cur.copy}</p>
      </div>
    </div>
  );
}
