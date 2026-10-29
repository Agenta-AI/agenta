import { useState } from "react";
import {
  ArrowLeft,
  ClockCounterClockwise,
  CaretRight,
  WarningCircle,
  ChatCircle,
  CheckCircle,
} from "@phosphor-icons/react";

// Local example deliveries, following the product's run-list and conversation layout.
export default function AutomationHistory({
  automation,
  onBack,
  empty = false,
}) {
  const [selected, setSelected] = useState(null);
  const runs = empty
    ? []
    : Array.from({ length: automation.runCount }, (_, i) => ({
        id: i,
        day:
          automation.runCount === 4
            ? i === 0
              ? "This week"
              : `${i * 7} days ago`
            : i === 0
              ? "Today"
              : i === 1
                ? "Yesterday"
                : `${Math.min(28, i + 1)} days ago`,
        time: automation.isSchedule
          ? automation.runsWhen.match(/\d{2}:\d{2}/)?.[0] || "09:00"
          : "10:42",
        label: automation.isSchedule ? "Scheduled run" : "Event run",
        outcome:
          i === 0 && automation.statusLabel === "Needs attention"
            ? "Failed"
            : i === 2
              ? "Skipped"
              : "Succeeded",
      }));
  const visible = runs;
  const active =
    visible.find((run) => run.id === selected) ||
    (selected === null ? visible[0] : null);
  const transcript = automation.transcript;
  return (
    <section
      className="ag-demo-history"
      aria-label={`${automation.name} run history`}
      data-run-open={selected !== null && selected !== -1}
    >
      <div className="ag-demo-history-list">
        <button className="ag-demo-back" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden />
          {automation.name}
        </button>
        <header>
          <h3>Run history</h3>
          <p>{runs.length} runs in the last 30 days</p>
        </header>
        <div className="ag-demo-runs">
          {visible.map((run) => (
            <div key={run.id}>
              <h4>{run.day}</h4>
              <button
                aria-current={active?.id === run.id ? "true" : undefined}
                aria-label={`${run.label}, ${run.outcome}, ${run.day} ${run.time}`}
                onClick={() => setSelected(run.id)}
              >
                <span className="ag-demo-run-dot" data-outcome={run.outcome} />
                <span>{run.label}</span>
                <time>{run.time}</time>
              </button>
            </div>
          ))}
          {!visible.length && (
            <div className="ag-demo-empty">
              <ClockCounterClockwise size={24} aria-hidden />
              <h4>No runs yet</h4>
              <p>When this automation runs, its history will appear here.</p>
            </div>
          )}
        </div>
      </div>
      {active && (
        <div className="ag-demo-run-pane">
          <header>
            <button
              className="ag-demo-run-back"
              aria-label="Back to the run list"
              onClick={() => setSelected(-1)}
            >
              <ArrowLeft size={16} />
            </button>
            <span className="ag-demo-run-dot" data-outcome={active.outcome} />
            <strong>{active.label}</strong>
            <span>
              {active.day} {active.time}
            </span>
          </header>
          <div className="ag-demo-transcript" key={active.id}>
            <p className="ag-demo-run-outcome">
              {active.outcome === "Succeeded" ? (
                <CheckCircle size={16} />
              ) : (
                <WarningCircle size={16} />
              )}{" "}
              {active.outcome}
            </p>
            {active.outcome !== "Succeeded" ? (
              <div className="ag-demo-empty">
                <ChatCircle size={24} />
                <h4>No conversation for this run</h4>
                <p>
                  {active.outcome === "Failed"
                    ? "The trigger could not start the agent. The connected service needs to be reconnected."
                    : "This event was already handled. The duplicate delivery was skipped."}
                </p>
              </div>
            ) : (
              <>
                <div className="ag-demo-user-message">
                  {automation.instruction}
                </div>
                <div className="ag-demo-agent-name">{automation.agent}</div>
                <details open>
                  <summary>
                    <CaretRight size={12} />
                    {transcript.worked}
                  </summary>
                  <ol>
                    {transcript.steps.map((step, i) => (
                      <li key={i}>
                        {step.pre} <strong>{step.bold}</strong> {step.post}
                      </li>
                    ))}
                  </ol>
                </details>
                <p>{transcript.reply}</p>
                <span className="ag-demo-sample-label">
                  Sample conversation
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
