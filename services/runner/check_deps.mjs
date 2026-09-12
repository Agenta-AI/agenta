#!/usr/bin/env node
/** Compare direct runner dependencies with the lockfile and npm registry. */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");

const colors = { green: "\x1b[32m", yellow: "\x1b[33m", orange: "\x1b[38;5;214m", red: "\x1b[31m", reset: "\x1b[0m" };

function importerVersions(text) {
  const importer = text.match(/(?:^|\n)  \.\:\n([\s\S]*?)(?=\npackages:|\nsnapshots:|$)/)?.[1] ?? "";
  const versions = new Map();
  let name;
  for (const line of importer.split("\n")) {
    const entry = line.match(/^ {6}(?:'([^']+)'|([^:]+)):\s*$/);
    if (entry) {
      name = entry[1] ?? entry[2];
      continue;
    }
    const version = line.match(/^ {8}version: ['"]?([^'"\s]+).*$/);
    if (version && name) versions.set(name, version[1].replace(/\(.*/, ""));
  }
  return versions;
}

function registryName(name, specifier) {
  if (!specifier.startsWith("npm:")) return name;
  const alias = specifier.slice(4);
  return alias.slice(0, alias.lastIndexOf("@"));
}

function comparable(value) {
  const match = value.match(/(?:^|@)(\d+(?:\.\d+){1,2}(?:[-+][\w.-]+)?)/g)?.at(-1);
  return (match ?? value).replace(/^@/, "");
}

function colorize(line, locked, latest) {
  const left = comparable(locked).match(/^\d+(?:\.\d+){0,2}/)?.[0]?.split(".").map(Number);
  const right = comparable(latest).match(/^\d+(?:\.\d+){0,2}/)?.[0]?.split(".").map(Number);
  if (!left || !right) return line;
  const color = left[0] === right[0] ? (left[1] === right[1] ? colors.yellow : colors.orange) : colors.red;
  return `${left.join(".") === right.join(".") ? colors.green : color}${line}${colors.reset}`;
}

const constraints = pkg.dependencies ?? {};
const locked = importerVersions(lock);
const rows = await Promise.all(Object.entries(constraints).map(async ([name, constraint]) => {
  const registry = registryName(name, constraint);
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(registry)}/latest`);
    const latest = response.ok ? (await response.json()).version ?? "" : "";
    return { name, constraint, locked: locked.get(name) ?? "", latest };
  } catch {
    return { name, constraint, locked: locked.get(name) ?? "", latest: "" };
  }
}));

const nameWidth = Math.max("package".length, ...rows.map(({ name }) => name.length)) + 2;
const constraintWidth = Math.max("constraint".length, ...rows.map(({ constraint }) => constraint.length)) + 2;
const lockedWidth = Math.max("locked".length, ...rows.map(({ locked }) => locked.length)) + 2;
const header = `${"package".padEnd(nameWidth)}${"constraint".padEnd(constraintWidth)}${"locked".padEnd(lockedWidth)}npm-latest`;
console.log(header);
console.log("-".repeat(header.length));
for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  const line = `${row.name.padEnd(nameWidth)}${row.constraint.padEnd(constraintWidth)}${row.locked.padEnd(lockedWidth)}${row.latest}`;
  console.log(colorize(line, row.locked, row.latest));
}
