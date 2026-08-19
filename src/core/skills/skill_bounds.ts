// Central bounds for skill metadata, loading, and instruction context.
// Exposed through the capability manifest — change deliberately.

export const SKILL_BOUNDS = {
  /** skill.json on disk. */
  maxMetadataBytes: 64 * 1024,
  /** SKILL.md instruction body. */
  maxInstructionBytes: 128 * 1024,
  /** One declared resource file. */
  maxResourceBytes: 256 * 1024,
  /** All loaded resources of one skill combined. */
  maxAggregateResourceBytes: 512 * 1024,
  /** Skills loaded into one turn (explicit + automatic). */
  maxSkillsPerTurn: 6,
  /** Automatic candidates loaded without explicit invocation. */
  maxAutomaticSkillsPerTurn: 3,
  /** Skill dependency chain depth. */
  maxDependencyDepth: 3,
  /** Approximate token budget for all loaded skill context. */
  maxLoadedSkillTokens: 16000,
  /** Instruction sources merged into one turn. */
  maxInstructionSources: 12,
  /** Nested AGENTS.md depth below the project root. */
  maxNestedInstructionDepth: 6,
  /** One instruction file. */
  maxInstructionFileBytes: 64 * 1024,
  /** Description / name / trigger phrase field lengths. */
  maxNameChars: 80,
  maxDescriptionChars: 1024,
  maxTriggerPhrases: 16,
  maxTriggerPhraseChars: 120,
  maxCommandAliases: 4,
  maxResources: 32,
  maxDependencies: 8,
} as const;

export type SkillBounds = typeof SKILL_BOUNDS;
