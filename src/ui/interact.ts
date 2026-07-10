// interact.ts — the host-side human-in-the-loop layer (confirm / ask / pause).
//
// The brain protocol is FROZEN (v2, mirrored Python<->TS + a conformance fixture),
// so the agent can NOT invent a new "ask" wire event. Every human moment therefore
// lives HERE, host-side, as a plain readline exchange the host owns: the repo gate
// before a run, a friendly pause at a stage boundary, the agent surfacing a
// clarifying question. Keeping it host-side means zero protocol drift.
//
// IO is injected so this is unit-testable and so --yes / non-TTY can auto-answer
// WITHOUT ever blocking a pipe, CI, or a test. Prompts + notes default to stderr,
// keeping stdout clean for piped transcripts (same choice stageGate already makes).

import { createInterface } from "node:readline";

export interface PromptIO {
  /** Ask one line; resolve with the raw (untrimmed) answer. */
  question(query: string): Promise<string>;
  /** Write a status/info line. Defaults to stderr so stdout stays pipe-clean. */
  note(line: string): void;
  /** Interactive terminal? false for pipes / CI / tests (never prompt then). */
  readonly tty: boolean;
}

/** Default IO: a fresh readline per question (created + closed each call, exactly
 * like stageGate), with prompts + notes on stderr so piped stdout is untouched. */
export function stdioPrompt(): PromptIO {
  return {
    tty: Boolean(process.stdin.isTTY),
    note(line: string): void {
      process.stderr.write(line + "\n");
    },
    question(query: string): Promise<string> {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      return new Promise<string>((resolve) => {
        rl.question(query, (ans) => {
          rl.close();
          resolve(ans);
        });
      });
    },
  };
}

export interface ConfirmOptions {
  /** Answer when the user just hits enter — and the value taken in non-TTY. */
  default?: boolean;
  /** --yes: accept without prompting (prints a friendly note instead). */
  autoYes?: boolean;
}

// Generous synonym sets — "super friendly" means a human's natural yes/no lands.
const YES = new Set(["y", "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "aye"]);
const NO = new Set(["n", "no", "nope", "nah", "cancel", "abort"]);

/**
 * Ask a yes/no question. `--yes` short-circuits to true; a non-TTY (pipe/CI) takes
 * `default` without prompting so it can never hang. On an unrecognized answer it
 * re-asks ONCE, then falls back to `default`.
 */
export async function confirm(io: PromptIO, question: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const def = opts.default ?? true;
  const hint = def ? "[Y/n]" : "[y/N]";
  if (opts.autoYes) {
    io.note(`${question} ${hint} y  (--yes)`);
    return true;
  }
  if (!io.tty) return def; // pipe / CI / test — cannot prompt, take the default
  for (let attempt = 0; attempt < 2; attempt++) {
    const ans = (await io.question(`${question} ${hint} `)).trim().toLowerCase();
    if (ans === "") return def;
    if (YES.has(ans)) return true;
    if (NO.has(ans)) return false;
    io.note("  (please answer y or n)");
  }
  return def;
}

export interface AskOptions {
  /** Value returned in non-TTY / --yes scripted runs (default ""). */
  auto?: string;
  /** --yes present -> use `auto` without prompting. */
  autoYes?: boolean;
}

/** Ask a free-text question. Non-TTY / --yes returns `auto` (default ""). The
 * answer is trimmed (a bare enter -> ""). */
export async function ask(io: PromptIO, question: string, opts: AskOptions = {}): Promise<string> {
  if (opts.autoYes || !io.tty) return opts.auto ?? "";
  return (await io.question(`${question} `)).trim();
}

/**
 * Detect an agent question embedded in a monologue line. The brain protocol is
 * FROZEN, so the agent can't emit a new "ask" wire event — instead it prefixes a
 * monologue with a question marker (❓ / ⁇ / "?>" / "question:" / "ask user:")
 * and the host turns that into a REAL prompt, feeding the answer back as a
 * control("steer", ...). Returns the question text, or null for an ordinary
 * monologue. Pure + testable; the orchestration lives in commands/code.ts.
 */
export function parseAgentQuestion(text: string): string | null {
  const m = /^\s*(?:❓|⁇|\?>|question\s*:|ask\s*user\s*:)\s*(.+)$/is.exec(text);
  const q = m?.[1]?.trim();
  return q ? q : null;
}
