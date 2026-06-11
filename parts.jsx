/* global React */
/* Slash command reference — grouped, color-sorted, compact. */

const CMD_GROUPS = [
  {
    title: 'Session', accent: '#22d3ee',
    cmds: [
      ['/help', 'grouped command menu'],
      ['/models', 'list chat models'],
      ['/model <n|id>', 'switch model · restarts session'],
      ['/agents', 'active agent sessions'],
      ['/agent <n|id>', 'switch orchestrator'],
      ['/tier', 'plan tier + defaults'],
      ['/audit [n]', 'recent custody receipts'],
      ['/doctor', 'diagnose setup'],
      ['/clear', 'clear the screen'],
      ['/mcp', 'MCP servers · soon'],
      ['/exit · /quit', 'leave the REPL'],
    ],
  },
  {
    title: 'Agent modes', accent: '#4ade80',
    cmds: [
      ['/autonomous-execution', 'run end-to-end, no prompts'],
      ['/subagent-driven', 'decompose + delegate'],
      ['/self-review', 'review your recent work'],
      ['/recon <topic>', 'deep codebase recon'],
      ['/plan <topic>', 'write an implementation plan'],
      ['/writing-plans', 'write a plan →'],
      ['/research <topic>', 'research → gather → summarize'],
      ['/review', 'full project review'],
      ['/code-review', 'clean up + simplify sweep'],
      ['/writing-skills', 'author reusable skills'],
    ],
  },
  {
    title: 'Steering', accent: '#fbbf24',
    cmds: [
      ['/queue <task>', 'run after current finishes'],
      ['/steer <guidance>', 'mid-task steer, next turn'],
      ['/btw <note>', 'contextual side note'],
    ],
  },
  {
    title: 'Context & limits', accent: '#a78bfa',
    cmds: [
      ['/pin <path> [reason]', 'force file into context'],
      ['/pin list', 'list pinned files'],
      ['/drop <path>', 'evict file from context'],
      ['/snapshot', 'save session to disk'],
      ['/snapshot resume [id]', 'reload a snapshot'],
      ['/snapshot list', 'list snapshots'],
      ['/limit <uvt>', 'cap session spend'],
      ['/audit-receipt [n]', 'verified tool-call log'],
      ['/rollback [n]', 'revert last n changes'],
      ['/logs · /logs-view', 'session log browser'],
    ],
  },
  {
    title: 'Goals & workflows', accent: '#7dd3fc',
    cmds: [
      ['/goal <desc>', 'create a goal · plan phases'],
      ['/goal view [id]', 'goal chain + detail'],
      ['/goal start|pause|…', "drive a goal's lifecycle"],
      ['/goals [id]', 'list goals or view one'],
      ['/workflow', 'workflow status'],
      ['/workflow-templates', 'list templates'],
      ['/workflow-template <n>', 'load a template'],
    ],
  },
  {
    title: 'Vault', accent: '#f472b6',
    cmds: [
      ['/vault', 'vault status'],
      ['/vault-context', 'load vault into next turn'],
      ['/vault-search <q>', 'search notes'],
      ['/vault-recent [n]', 'most recent notes'],
      ['/vault-project <name>', 'notes for a project'],
      ['/vault-tag <tag>', 'notes by tag'],
      ['/vault-tree', 'vault folder tree'],
    ],
  },
  {
    title: 'Orchestra', accent: '#fb923c',
    cmds: [
      ['/delegate <model> <task>', 'delegate a sub-task'],
      ['/tree', 'live orchestration tree'],
      ['/broadcast "<msg>"', 'directive to all sub-agents'],
      ['/gather <id|all>', 'merge sub-agent work'],
    ],
  },
];

function CmdGroup({ g }) {
  return (
    <div style={{
      breakInside: 'avoid', WebkitColumnBreakInside: 'avoid',
      marginBottom: 18, paddingBottom: 2,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7,
        paddingBottom: 6, borderBottom: `1px solid ${g.accent}55`,
      }}>
        <span style={{ color: g.accent, fontSize: 11 }}>▸</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: g.accent }}>
          {g.title}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--muted-dim)' }}>{g.cmds.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {g.cmds.map(([cmd, desc]) => (
          <div key={cmd} style={{ display: 'flex', alignItems: 'baseline', gap: 8, lineHeight: 1.35 }}>
            <code style={{
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
              color: g.accent, whiteSpace: 'nowrap', flexShrink: 0,
            }}>{cmd}</code>
            <span style={{ fontSize: 10.5, color: 'var(--muted)', minWidth: 0 }}>{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandsSection() {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{
      padding: open ? 'clamp(22px, 3vw, 32px) clamp(20px, 3.6vw, 44px) clamp(26px, 3.6vw, 42px)' : 'clamp(18px, 2.4vw, 24px) clamp(20px, 3.6vw, 44px)',
      borderTop: '1px dashed rgba(56,189,248,0.28)',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
          width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 0, marginBottom: open ? 22 : 0, fontFamily: 'inherit',
        }}
        aria-expanded={open}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{
            color: 'var(--cyan)', fontSize: 12, display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .25s ease',
          }}>▸</span>
          <span style={{ fontFamily: 'var(--sans)', fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: '#eafafe' }}>Slash commands</span>
        </div>
        <div style={{ color: 'var(--muted-dim)', fontSize: 12.5, marginTop: 1 }}>
          {open
            ? <>everything the REPL understands — type <code style={{ color: 'var(--cyan)', fontFamily: 'var(--mono)' }}>/help</code> in-session</>
            : 'session, agent modes, steering, context, goals, vault & orchestra'}
        </div>
      </button>
      <div style={{ display: open ? 'block' : 'none' }}>
        <div className="cmd-cols" style={{
          columnCount: 3, columnGap: 'clamp(20px, 3vw, 40px)',
        }}>
          {CMD_GROUPS.map(g => <CmdGroup key={g.title} g={g} />)}
        </div>
      </div>
    </div>
  );
}

window.CommandsSection = CommandsSection;
