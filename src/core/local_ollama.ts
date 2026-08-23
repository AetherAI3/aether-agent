import { DEFAULT_OLLAMA_MODEL } from "./ollama.js";

export const LOCAL_MODEL_PREFIX = "ollama:";

/** A local model id is namespaced so it can never be mistaken for a hosted id. */
export function localModelId(tag: string): string {
  const normalized = normalizeOllamaTag(tag);
  return `${LOCAL_MODEL_PREFIX}${normalized}`;
}

/** Return the Ollama tag carried by a namespaced id, or null for hosted ids. */
export function ollamaTagFromId(id: string | null | undefined): string | null {
  const value = (id ?? "").trim();
  if (!value.startsWith(LOCAL_MODEL_PREFIX)) return null;
  const tag = value.slice(LOCAL_MODEL_PREFIX.length);
  try {
    return normalizeOllamaTag(tag);
  } catch {
    return null;
  }
}

/**
 * Resolve the tag for a local run. A bare explicit --model remains supported,
 * because --local makes that intent unambiguous. A saved default is used only
 * when it carries the ollama: namespace; hosted defaults never become tags.
 */
export function resolveLocalModel(explicit: string | undefined, savedDefault: string): string {
  if (explicit?.trim()) {
    if (explicit.trim().startsWith(LOCAL_MODEL_PREFIX)) {
      return normalizeOllamaTag(explicit.trim().slice(LOCAL_MODEL_PREFIX.length));
    }
    return normalizeOllamaTag(explicit);
  }
  return ollamaTagFromId(savedDefault) ?? DEFAULT_OLLAMA_MODEL;
}

/** Validate a tag before it reaches argv, config, a URL, or terminal output. */
export function normalizeOllamaTag(raw: string): string {
  const tag = raw.trim();
  if (!tag) throw new Error("Ollama model tag is empty");
  if (tag.length > 200) throw new Error("Ollama model tag is too long (maximum 200 characters)");
  if (/[\u0000-\u001f\u007f\s]/.test(tag)) throw new Error("Ollama model tag cannot contain whitespace or control characters");
  // Ollama names are path-like and may include a registry port and a :tag.
  // This deliberately excludes option-looking values and URL/query syntax.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:\-]*$/.test(tag) || tag.includes("..") || tag.endsWith("/")) {
    throw new Error(`Invalid Ollama model tag ${JSON.stringify(tag)}`);
  }
  return tag;
}
