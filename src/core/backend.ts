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
