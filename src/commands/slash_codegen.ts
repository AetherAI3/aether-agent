// In-REPL codegen/verification slash commands: /scaffold /port /test-drive
// /bench. Split out of slash.ts (was 1807 lines) to keep each command group
// under the repo's ~800-line file convention.

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import { theme } from "../ui/theme.js";
import { generateScaffold, isValidScaffoldType, SCAFFOLD_USAGE, type ScaffoldType } from "../core/scaffold.js";
import { portCode, readSource, writePortedFiles } from "../core/port.js";
import { startTestDrive } from "../core/test_drive.js";
import { runBenchmark } from "../core/bench.js";
import { requireOrchestrator } from "../core/orchestrator.js";

// ── /scaffold ─────────────────────────────────

export async function scaffoldSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim().split(/\s+/);
  const type = parts[0]?.toLowerCase() ?? "";
  const name = parts.slice(1).join(" ");

  if (!type || !name) {
    out.write(SCAFFOLD_USAGE + "\n");
    return;
  }

  if (!isValidScaffoldType(type)) {
    out.write(`invalid type: ${type} — use component, route, or module\n`);
    return;
  }

  try {
    out.write(`scaffolding ${type} "${name}"...\n`);
    const r = await generateScaffold(ctx.api, type as ScaffoldType, name);
    for (const f of r.files) {
      out.write(`  created: ${theme.bold(f.path)}  (${f.content.split("\n").length} lines)\n`);
    }
    out.write(`template: ${theme.dim(r.template_used)}\n`);
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── /port ─────────────────────────────────────

export async function portSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim().split(/\s+/);
  const targetPath = parts[0];
  const targetLang = parts[1]?.toLowerCase();

  if (!targetPath || !targetLang) {
    out.write("usage: /port <file|dir> <target_language>\n");
    out.write("  /port src/utils.ts rust\n");
    out.write("  /port src/services/ python\n");
    return;
  }

  try {
    const files = readSource(targetPath);
    out.write(`reading ${files.length} file(s) from ${targetPath}...\n`);

    const r = await portCode(ctx.api, files, targetLang);
    out.write(`translated → ${r.files.length} file(s)\n`);

    const outDir = `ported_${targetLang}`;
    const written = writePortedFiles(r.files, outDir);
    for (const w of written) {
      out.write(`  ${theme.bold(w)}\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── /test-drive ─────────────────────────────────

export async function testDriveSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;

  const target = arg.trim().replace(/^["']|["']$/g, "");
  if (!target) {
    out.write('usage: /test-drive "<route|function>"\n');
    out.write('  /test-drive "POST /api/users"\n');
    out.write('  /test-drive "src/utils/validate.ts:validateEmail"\n');
    return;
  }

  try {
    out.write(`${theme.cyan("🧪 test-drive")}  targeting: ${theme.bold(target)}\n`);
    out.write(theme.dim("  Generating test matrix, running, iterating until green...\n\n"));

    const r = await startTestDrive(ctx.api, ctx.flags.agent!, target, process.cwd());

    if (r.status === "passed") {
      out.write(`${theme.cyan("✓ all tests pass")}  after ${r.iterations} iteration(s)\n`);
      if (r.final_result) {
        out.write(`  ${r.final_result.passed} passed · ${r.final_result.failed} failed\n`);
      }
      if (r.patches.length > 0) {
        out.write(`  ${r.patches.length} source file(s) modified\n`);
        for (const p of r.patches) {
          out.write(`    ${theme.bold(p.file)}\n`);
        }
      }
    } else {
      out.write(`${theme.muted("✗ tests did not converge")} after ${r.iterations} iteration(s)\n`);
      if (r.final_result?.errors.length) {
        for (const e of r.final_result.errors.slice(0, 3)) {
          out.write(`  ${theme.muted(e.slice(0, 200))}\n`);
        }
      }
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── /bench ─────────────────────────────────────

export async function benchSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;

  const target = arg.trim();
  if (!target) {
    out.write("usage: /bench <function|endpoint>\n");
    out.write("  /bench src/services/search.ts:fullTextSearch\n");
    out.write("  /bench GET /api/search\n");
    return;
  }

  try {
    out.write(`${theme.cyan("⚡ benchmarking")}  ${theme.bold(target)}...\n`);

    const r = await runBenchmark(ctx.api, ctx.flags.agent!, target);

    if (r.complexity) {
      out.write(`\n  complexity: ${theme.bold(r.complexity)}\n`);
    }
    if (r.bottlenecks.length > 0) {
      out.write(`\n  ${theme.muted("bottlenecks:")}\n`);
      for (const b of r.bottlenecks) {
        out.write(`    ${theme.muted("•")} ${b}\n`);
      }
    }
    if (r.optimizations.length > 0) {
      out.write(`\n  ${theme.cyan("optimizations:")}\n`);
      for (const o of r.optimizations) {
        out.write(`    ${theme.cyan("→")} ${o.description}  ${theme.dim(`(${o.improvement})`)}\n`);
      }
    }
    if (r.patches.length > 0) {
      out.write(`\n  ${r.patches.length} optimization(s) applied\n`);
      for (const p of r.patches) {
        out.write(`    ${theme.bold(p.file)}\n`);
      }
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
