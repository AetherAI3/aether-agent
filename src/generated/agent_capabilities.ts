// GENERATED — do not edit by hand.
// Source: AetherAI3/AETHER-CLOUD contracts/agent-capabilities.v1.json
// Source commit: 97eacd3e9aca4df226cae638f8f8868b8219fe88
// Contract version: 1
// Canonical sha256: 8da094234a370a28dfd6206f039425f086307aa9ca0a67bc004d3d453716ac04
// Regenerate (no generator script is checked in; this is the whole procedure):
//   1. Take contracts/agent-capabilities.v1.json from the source repo at the
//      commit you want to pin.
//   2. Paste it as AGENT_CAPABILITIES_FALLBACK below, and set the header's
//      "Source commit" to that commit.
//   3. Recompute AGENT_CAPABILITIES_DIGEST as the sha256 of the CANONICAL
//      encoding — JSON with object keys sorted recursively, no whitespace:
//        sha256(JSON.stringify(sortKeysDeep(contract)))
//      and copy it into the "Canonical sha256" header line too.
//   4. Update AGENT_CAPABILITIES_SOURCE.commit / .contractVersion to match.
// The digest below was verified to reproduce under exactly that recipe.

/** Offline fallback snapshot of the canonical agent capability contract. */
export const AGENT_CAPABILITIES_FALLBACK = {
  "contract_version": 1,
  "dev_session_protocol_versions": [
    1
  ],
  "tools": [
    {
      "name": "read_file",
      "schema_version": 1,
      "side_effect": "read",
      "permission": "workspace.read",
      "deterministic": false,
      "host": [
        "cli",
        "desktop",
        "cloud"
      ]
    },
    {
      "name": "repo_search",
      "schema_version": 1,
      "side_effect": "read",
      "permission": "workspace.read",
      "deterministic": false,
      "host": [
        "cli",
        "desktop",
        "cloud"
      ]
    },
    {
      "name": "write_file",
      "schema_version": 1,
      "side_effect": "write",
      "permission": "workspace.write",
      "deterministic": false,
      "host": [
        "cli",
        "desktop",
        "cloud"
      ]
    },
    {
      "name": "run_shell",
      "schema_version": 1,
      "side_effect": "shell",
      "permission": "shell.execute",
      "deterministic": false,
      "host": [
        "cli",
        "desktop",
        "cloud"
      ]
    },
    {
      "name": "run_tests",
      "schema_version": 1,
      "side_effect": "shell",
      "permission": "shell.test",
      "deterministic": false,
      "host": [
        "cli",
        "desktop",
        "cloud"
      ]
    },
    {
      "name": "git_commit",
      "schema_version": 1,
      "side_effect": "git",
      "permission": "git.commit",
      "deterministic": false,
      "host": [
        "cli",
        "desktop",
        "cloud"
      ]
    },
    {
      "name": "web_search",
      "schema_version": 1,
      "side_effect": "network",
      "permission": "network.general",
      "deterministic": false,
      "host": [
        "cli",
        "desktop",
        "cloud"
      ]
    },
    {
      "name": "web_fetch",
      "schema_version": 1,
      "side_effect": "network",
      "permission": "network.general",
      "deterministic": false,
      "host": [
        "cli",
        "desktop",
        "cloud"
      ]
    }
  ],
  "permissions": [
    "workspace.read",
    "workspace.write",
    "workspace.outside",
    "shell.test",
    "shell.execute",
    "git.read",
    "git.stage",
    "git.commit",
    "git.push",
    "network.github.read",
    "network.general",
    "network.loopback",
    "secrets.read",
    "billing.spend",
    "artifact.publish"
  ],
  "permission_modes": [
    "ask",
    "auto",
    "skip"
  ],
  "effort_tiers": [
    "LOW",
    "MED",
    "HIGH",
    "MAX",
    "ULTRA",
    "CODEPRO"
  ],
  "skill_schema_versions": [
    1
  ],
  "skill_context_contract_versions": [
    1
  ],
  "instruction_context_contract_versions": [
    1
  ],
  "instruction_source_types": [
    "aether-project",
    "agents-root",
    "agents-nested",
    "aether-user",
    "claude",
    "gemini",
    "copilot",
    "cursor-rule"
  ],
  "doctor": {
    "schema_versions": [
      1,
      2
    ],
    "modes": [
      "fast",
      "network",
      "live",
      "fix"
    ],
    "categories": [
      "runtime",
      "installation",
      "configuration",
      "workspace",
      "git",
      "auth",
      "transport",
      "tools",
      "permissions",
      "skills",
      "instructions",
      "memory",
      "mcp",
      "artifacts",
      "persistence",
      "support"
    ]
  },
  "support_bundle_schema_versions": [
    1
  ],
  "skill_error_codes": [
    "skill.untrusted",
    "skill.changed",
    "skill.disabled",
    "skill.ambiguous",
    "skill.not_found",
    "skill.schema_invalid",
    "skill.version_incompatible",
    "skill.dependency_missing",
    "skill.dependency_cycle",
    "skill.context_budget_exceeded",
    "skill.tool_not_declared",
    "skill.permission_unavailable",
    "skill.permission_denied",
    "skill.resource_unsafe",
    "skill.resource_changed",
    "skill.server_unsupported"
  ],
  "limits": {
    "max_skills_per_turn": 6,
    "max_automatic_skills_per_turn": 3,
    "max_loaded_skill_tokens": 16000,
    "max_instruction_sources": 12,
    "max_instruction_file_bytes": 65536,
    "max_skill_context_bytes": 262144,
    "max_instruction_context_bytes": 196608,
    "max_skills_in_context": 6,
    "max_instruction_sources_in_context": 12
  },
  "client_features": [
    "skills",
    "instructions",
    "doctor_v2",
    "support_bundle",
    "capability_matrix"
  ]
} as const;

/** sha256 over the canonical (sorted-keys, compact) JSON encoding. */
export const AGENT_CAPABILITIES_DIGEST = "8da094234a370a28dfd6206f039425f086307aa9ca0a67bc004d3d453716ac04";

export const AGENT_CAPABILITIES_SOURCE = {
  repository: "AetherAI3/AETHER-CLOUD",
  commit: "97eacd3e9aca4df226cae638f8f8868b8219fe88",
  contractVersion: 1,
} as const;
