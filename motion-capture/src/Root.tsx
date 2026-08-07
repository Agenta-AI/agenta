import React from "react";
import { Composition, staticFile } from "remotion";
import { DemoClip, type DemoClipProps } from "./DemoClip";
import { EMPTY_LOG, type ClickLog } from "./lib/zoom";

const FPS = 30;

// The prototype clip. Add more <Composition>s (or make this dynamic) per flow.
const CLIP_NAME = "create-agent";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="DemoClip"
      component={DemoClip}
      durationInFrames={FPS * 8}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ name: CLIP_NAME, log: EMPTY_LOG } satisfies DemoClipProps}
      calculateMetadata={async ({ props }) => {
        // Read the click log written by the recorder; it carries the real size,
        // duration, and zoom keyframes so nothing here is hand-tuned.
        let log: ClickLog = EMPTY_LOG;
        try {
          const res = await fetch(staticFile(`${props.name}.clicks.json`));
          log = (await res.json()) as ClickLog;
        } catch {
          // No recording yet — fall back to defaults so Studio still opens.
        }
        return {
          durationInFrames: Math.max(1, Math.ceil((log.durationMs / 1000) * FPS)),
          width: log.viewport.width,
          height: log.viewport.height,
          props: { ...props, log },
        };
      }}
    />
  );
};
