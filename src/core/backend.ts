// Backend selection — the ONE pure decision behind local-first routing.
//
// The CLI runs the cloud brain (Aether API, UVT-metered, signed) when the user
// is signed in, and the local Ollama brain (offline, free) when they are not.
// An explicit choice ('local' | 'cloud') always wins; 'auto' (the default, and
// the fallback for any unrecognized value) routes on auth state. Kept pure and
// side-effect free so the matrix is exhaustively unit-tested (backend_select).

export type BackendPref = "auto" | "local" | "cloud";
export type BackendPath = "local" | "cloud";

/**
 * Resolve the concrete backend for a turn.
 *  - "cloud" -> cloud (always)
 *  - "local" -> local (always)
 *  - "auto" / anything else -> cloud when authed, else local
 */
export function chooseBackend(backend: string, authed: boolean): BackendPath {
  if (backend === "cloud") return "cloud";
  if (backend === "local") return "local";
  // 'auto' and any garbage value: route on auth state (cloud when signed in).
  return authed ? "cloud" : "local";
}

export type LocalBrainKind = "ollama" | "python";

/**
 * Resolve WHICH local brain drives an offline run.
 *
 * Two local brains exist. The Ollama brain (core/brain_ollama.ts) is pure
 * TypeScript, ships inside the npm package, and needs nothing but Node and a
 * running Ollama — it is what `aether agent --local` has always used in the
 * REPL. The headless Python brain (core/brain_local.ts) spawns
 * `python -m aether_agent.headless`, which is a SEPARATE install that the npm
 * package does not carry; asking for it when it is absent fails with
 * "spawn python ENOENT".
 *
 * So the shipped brain is the default and Python is opt-in, via
 * AETHER_LOCAL_BRAIN=python (any other value, including unset, means ollama).
 * Pure so the matrix is unit-testable.
 */
export function chooseLocalBrain(pref: string | undefined): LocalBrainKind {
  return (pref ?? "").trim().toLowerCase() === "python" ? "python" : "ollama";
}
