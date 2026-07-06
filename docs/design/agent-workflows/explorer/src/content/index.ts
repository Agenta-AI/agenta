import { Section00Intro } from "./section00-intro";
import { Section01Map } from "./section01-map";
import { Section02Invoke } from "./section02-invoke";
import { Section03Streaming } from "./section03-streaming";
import { Section04Tools } from "./section04-tools";
import { Section05Permissions } from "./section05-permissions";
import { Section06Load } from "./section06-load";
import { Section07Gaps } from "./section07-gaps";
import { SourcesAppendix } from "./sourcesAppendix";
import type { ComponentType } from "react";

export interface ArticleSection {
  id: string;
  tocLabel: string;
  Component: ComponentType;
}

export const ARTICLE_SECTIONS: ArticleSection[] = [
  { id: "s0-intro", tocLabel: "Intro", Component: Section00Intro },
  { id: "s1-map", tocLabel: "The map", Component: Section01Map },
  { id: "s2-invoke", tocLabel: "The journey", Component: Section02Invoke },
  { id: "s3-streaming", tocLabel: "Streaming", Component: Section03Streaming },
  { id: "s4-tools", tocLabel: "Tools", Component: Section04Tools },
  { id: "s5-permissions", tocLabel: "Permissions", Component: Section05Permissions },
  { id: "s6-load", tocLabel: "Load & scale", Component: Section06Load },
  { id: "s7-gaps", tocLabel: "What's not real yet", Component: Section07Gaps },
  { id: "sources", tocLabel: "Sources", Component: SourcesAppendix },
];
