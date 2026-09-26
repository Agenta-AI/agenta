// Fails the build when the generated template data is missing or inconsistent.
//
// src/data/templates.json is written by the catalog's Python reader
// (see WEBSITE_COMMAND below), never by hand. This check only guards the
// references the pages rely on, so a bad file stops the build with a clear
// message instead of emitting broken template or author pages.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WEBSITE_COMMAND =
  "cd api && uv run python -m oss.src.core.agent_templates.marketplace website";

export function checkTemplateData(data) {
  const problems = [];
  if (!data || data.schema_version !== 1) {
    problems.push(
      `unsupported schema_version ${JSON.stringify(data?.schema_version)}; expected 1`,
    );
    return problems;
  }
  const templates = Array.isArray(data.templates) ? data.templates : [];
  const authors = Array.isArray(data.authors) ? data.authors : [];
  const templateKeys = new Set();
  for (const template of templates) {
    if (!template?.key) {
      problems.push("a template has no key");
      continue;
    }
    if (templateKeys.has(template.key)) {
      problems.push(`template "${template.key}" appears twice`);
    }
    templateKeys.add(template.key);
  }
  const authorIds = new Set(authors.map((author) => author?.id));
  for (const template of templates) {
    const authorId = template?.author?.id;
    if (!authorIds.has(authorId)) {
      problems.push(
        `template "${template?.key}" references author "${authorId}", which is not in authors`,
      );
    }
  }
  for (const author of authors) {
    for (const key of author?.template_keys ?? []) {
      if (!templateKeys.has(key)) {
        problems.push(
          `author "${author.id}" lists template "${key}", which is not in templates`,
        );
      }
    }
  }
  return problems;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const file = resolve(root, "src/data/templates.json");
  let problems;
  if (!existsSync(file)) {
    problems = ["src/data/templates.json does not exist"];
  } else {
    try {
      problems = checkTemplateData(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      problems = [
        `src/data/templates.json is not valid JSON: ${error.message}`,
      ];
    }
  }
  if (problems.length) {
    console.error("Template data check failed:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `Regenerate the file from the catalog with: ${WEBSITE_COMMAND}`,
    );
    process.exit(1);
  }
}
