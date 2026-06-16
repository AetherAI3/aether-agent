// sink.ts — the write target for terminal renderers. Decouples rendering from
// process.stdout so the SAME renderer drives a real TTY (CLI), an xterm.js
// instance (desktop/web embed), or a test buffer. Color/TTY/dims are properties
// of the sink, NOT globals — that is what lets an Electron renderer (isTTY=false)
// still get full ANSI when it asks for it.

export interface RenderSink {
  write(s: string): void;
  readonly columns: number;
  readonly rows: number;
  readonly isTTY: boolean;
  readonly colorEnabled: boolean;
}

/** CLI sink — wraps process.stdout. Color policy = TTY && NO_COLOR unset. */
export class StdoutSink implements RenderSink {
  write(s: string): void {
    process.stdout.write(s);
  }
  get columns(): number {
    return process.stdout.columns ?? 80;
  }
  get rows(): number {
    return process.stdout.rows ?? 24;
  }
  get isTTY(): boolean {
    return Boolean(process.stdout.isTTY);
  }
  get colorEnabled(): boolean {
    return Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"];
  }
}

export interface StringSinkOptions {
  columns?: number;
  rows?: number;
  isTTY?: boolean;
  colorEnabled?: boolean;
}

/** Embed/test sink — accumulates writes; dims and flags are caller-controlled. */
export class StringSink implements RenderSink {
  buffer = "";
  readonly columns: number;
  readonly rows: number;
  readonly isTTY: boolean;
  readonly colorEnabled: boolean;

  constructor(opts: StringSinkOptions = {}) {
    this.columns = opts.columns ?? 80;
    this.rows = opts.rows ?? 24;
    this.isTTY = opts.isTTY ?? false;
    this.colorEnabled = opts.colorEnabled ?? false;
  }

  write(s: string): void {
    this.buffer += s;
  }
}
