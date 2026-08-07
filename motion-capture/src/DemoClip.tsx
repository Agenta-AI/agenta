import React from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import { zoomAt, type ClickLog } from "./lib/zoom";

const round = (n: number) => Math.round(n);

export type DemoClipProps = {
  name: string;
  log: ClickLog;
};

/**
 * Embeds the recorded MP4 and applies an automatic Ken-Burns zoom at each click
 * (timing + position come from the click log). Rounded corners + a padded dark
 * backdrop make it read as "product footage" rather than a raw screen grab.
 */
export const DemoClip: React.FC<DemoClipProps> = ({ name, log }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { scale, originX, originY } = zoomAt(frame, fps, log);
  const trimBefore = log.trimBeforeMs ? round((log.trimBeforeMs / 1000) * fps) : undefined;

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(120% 90% at 50% -10%, #2a3f6b 0%, #182548 42%, #0b1120 100%)",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* The composition is exactly 16:9 (== the recording), so a full-size box +
          objectFit:"fill" shows the ENTIRE app with zero crop. The premium inset
          border comes from scaling the whole framed box down uniformly (which
          preserves 16:9), NOT from padding — padding changed the aspect ratio and
          made `cover` slice the top and bottom off the app. */}
      <div
        style={{
          width: "100%",
          height: "100%",
          transform: "scale(0.97)",
          borderRadius: 14,
          overflow: "hidden",
          position: "relative",
          // Richer, less "dull": lift saturation/contrast a touch and add depth.
          filter: "saturate(1.14) contrast(1.05) brightness(1.02)",
          boxShadow:
            "0 50px 110px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.10), 0 0 60px rgba(56,110,220,0.18)",
        }}
      >
        <Video
          src={staticFile(`${name}.mp4`)}
          trimBefore={trimBefore}
          objectFit="fill"
          style={{
            width: "100%",
            height: "100%",
            transform: `scale(${scale})`,
            transformOrigin: `${originX * 100}% ${originY * 100}%`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
