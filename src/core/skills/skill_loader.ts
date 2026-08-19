// Lazy body loading for a RESOLVED skill. Loads the entrypoint plus only the
// declared resources, re-verifying the content digest at open time so a file
// swapped between indexing and loading (TOCTOU) is refused, not shipped.

import { SkillError } from "./skill_errors.js";
import { SKILL_BOUNDS } from "./skill_bounds.js";
import { readBoundedInsideRoot, sha256Hex, calculateSkillDigest } from "./skill_digest.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LoadedSkill, LoadedSkillResource, SkillDescriptor, SkillInvocationKind } from "./skill_types.js";

/**
 * Load the instruction body and declared resources of one skill.
 * The whole-package digest is recalculated first and must equal the digest the
 * descriptor was indexed (and trusted) under — any drift refuses with
 * skill.resource_changed before a byte of content is returned.
 */
export function loadSkillBody(
  descriptor: SkillDescriptor,
  invocation: SkillInvocationKind,
): LoadedSkill {
  const manifestPath = join(descriptor.root, "skill.json");
  if (!existsSync(manifestPath)) {
    throw new SkillError({ code: "skill.resource_changed", skillId: descriptor.id, detail: "skill.json disappeared since indexing" });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new SkillError({ code: "skill.resource_changed", skillId: descriptor.id, detail: "skill.json became unreadable since indexing" });
  }
  const recheck = calculateSkillDigest(descriptor.root, descriptor.manifest, raw);
  if (!recheck.ok) {
    throw new SkillError({ code: "skill.resource_unsafe", skillId: descriptor.id, detail: recheck.error });
  }
  if (recheck.sha256 !== descriptor.sha256) {
    throw new SkillError({
      code: "skill.resource_changed",
      skillId: descriptor.id,
      detail: "content changed between indexing and load — re-index and re-trust before invoking",
    });
  }

  const entry = readBoundedInsideRoot(descriptor.root, descriptor.manifest.entrypoint, SKILL_BOUNDS.maxInstructionBytes);
  if (!entry.ok) {
    throw new SkillError({ code: "skill.resource_unsafe", skillId: descriptor.id, detail: entry.error });
  }
  const instructions = entry.bytes.toString("utf8");

  const resources: LoadedSkillResource[] = [];
  let aggregate = 0;
  for (const resourcePath of descriptor.manifest.context.resources) {
    const read = readBoundedInsideRoot(descriptor.root, resourcePath, SKILL_BOUNDS.maxResourceBytes);
    if (!read.ok) {
      throw new SkillError({ code: "skill.resource_unsafe", skillId: descriptor.id, detail: read.error });
    }
    if (read.bytes.includes(0)) {
      throw new SkillError({
        code: "skill.resource_unsafe",
        skillId: descriptor.id,
        detail: "binary resource not supported: " + resourcePath,
      });
    }
    aggregate += read.bytes.length;
    if (aggregate > SKILL_BOUNDS.maxAggregateResourceBytes) {
      throw new SkillError({
        code: "skill.context_budget_exceeded",
        skillId: descriptor.id,
        detail: "declared resources exceed " + SKILL_BOUNDS.maxAggregateResourceBytes + " aggregate bytes",
      });
    }
    resources.push({
      name: resourcePath,
      sha256: sha256Hex(read.bytes),
      content: read.bytes.toString("utf8"),
    });
  }

  return {
    descriptor,
    invocation,
    instructions,
    resources,
    loadedBytes: entry.bytes.length + aggregate,
  };
}
