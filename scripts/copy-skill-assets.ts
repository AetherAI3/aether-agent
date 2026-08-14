// Post-build asset copy: tsc emits only compiled .ts output, but built-in
// skills ship as data (skill.json, SKILL.md, references/**). Copy them next to
// the compiled tree so builtinSkillsRoot() (dist/src/core/skills →
// ../../skills/builtin, i.e. dist/src/skills/builtin) resolves in a build and
// in the packed artifact. Deterministic (sorted walk), zero dependencies.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Compiled location: <root>/dist/scripts/copy-skill-assets.js
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const sourceRoot = join(repoRoot, "src", "skills", "builtin");
const destRoot = join(repoRoot, "dist", "src", "skills", "builtin");

function copyTree(source: string, destination: string): number {
  let copied = 0;
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source).sort()) {
    const from = join(source, entry);
    const to = join(destination, entry);
    if (statSync(from).isDirectory()) copied += copyTree(from, to);
    else {
      copyFileSync(from, to);
      copied += 1;
    }
  }
  return copied;
}

function main(): void {
  if (!existsSync(sourceRoot)) {
    process.stdout.write("no built-in skills at " + sourceRoot + " — nothing to copy\n");
    return;
  }
  let copied = 0;
  for (const skillName of readdirSync(sourceRoot).sort()) {
    const skillDir = join(sourceRoot, skillName);
    if (!statSync(skillDir).isDirectory()) continue;
    for (const asset of ["skill.json", "SKILL.md"]) {
      const from = join(skillDir, asset);
      if (!existsSync(from)) continue;
      mkdirSync(join(destRoot, skillName), { recursive: true });
      copyFileSync(from, join(destRoot, skillName, asset));
      copied += 1;
    }
    for (const treeName of ["references", "evals", "templates"]) {
      const tree = join(skillDir, treeName);
      if (existsSync(tree) && statSync(tree).isDirectory()) {
        copied += copyTree(tree, join(destRoot, skillName, treeName));
      }
    }
  }
  process.stdout.write("copied " + copied + " built-in skill asset" + (copied === 1 ? "" : "s") + " → dist/src/skills/builtin\n");
}

main();
