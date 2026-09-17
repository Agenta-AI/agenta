import React from "react";
import clsx from "clsx";

type Props = {
  /** Full embed URL: a YouTube `/embed/...` link or a Cloudflare Stream `.../iframe` link. */
  src: string;
  /** Accessible title for the player. */
  title: string;
  /** Optional caption shown in a strip under the video. */
  caption?: string;
};

/**
 * A video in the standard media frame (16:9, rounded, bordered) with an
 * optional caption strip. The frame itself is styled in src/css/media.css,
 * which also covers raw <iframe> embeds; use this component on new pages so
 * the caption and the accessible title come along.
 */
export default function Video({ src, title, caption }: Props): JSX.Element {
  return (
    <figure className={clsx("mediaFigure", caption && "mediaFigure--captioned")}>
      <iframe
        src={src}
        title={title}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
      {caption && (
        <figcaption className="mediaCaption">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M10 8.5v7l5.5-3.5z" />
          </svg>
          <span>{caption}</span>
        </figcaption>
      )}
    </figure>
  );
}
