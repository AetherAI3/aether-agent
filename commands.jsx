/* global React, ReactDOM, AetherLogo, CloudAgent, IconInstall, IconCloud, IconLocal */
const { useState, useEffect, useRef, useCallback } = React;

/* ============================================================
   Copyable command block
   ============================================================ */
function CommandBlock({ lines }) {
  const [copied, setCopied] = useState(false);
  const text = lines.map(l => l.t).join("\n");

  const copy = useCallback(() => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else { done(); }
  }, [text]);

  return (
    <div
      onClick={copy}
      style={{
        position: 'relative', cursor: 'pointer',
        background: 'rgba(2, 12, 18, 0.66)',
        border: '1px solid var(--line)', borderRadius: 9,
        padding: '11px 52px 11px 12px', fontSize: 12, lineHeight: 1.6,
      }}
    >
      {lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {l.p && <span style={{ color: 'var(--muted-dim)' }}>{l.p} </span>}
          <span style={{ color: l.dim ? 'var(--muted)' : '#bfeaf2' }}>{l.cmd}</span>
          {l.arg && <span style={{ color: 'var(--cyan-bright)' }}>{l.arg}</span>}
        </div>
      ))}
      <span style={{
        position: 'absolute', top: 9, right: 10,
        fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: copied ? 'var(--green)' : 'var(--muted-dim)', transition: 'color .2s',
      }}>
        {copied ? '✓ copied' : 'copy'}
      </span>
    </div>
  );
}

/* ============================================================
   Hidden thinking tokens — reasoning model panel
   ============================================================ */
const THINKING = `the task is an async/await refactor of src/auth.ts — first I should
not trust my memory of the file, so I scan: 142 lines, 4 callback
sites in login(), refresh(), expiry guard, and a bad-token branch.
grep_symbol confirms 7 call sites across 2 files. converting the
callbacks naively would drop the error path, so each await needs a
try/catch; refresh() shares state with expiry — order matters there.
I'll stage 4 hunks + 1 test file (login · refresh · expiry · bad
token), keep edits path-guarded inside the working dir, and let the
host run the test command for ground truth rather than declaring
"done" myself. confidence on the plan: 0.93 → accept.`;

function ThinkingPanel({ active }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(0);
  const raf = useRef(null);

  useEffect(() => {
    if (!open) { setShown(0); return; }
    let i = 0;
    const tick = () => {
      i += 2;
      setShown(i);
      if (i < THINKING.length) raf.current = setTimeout(tick, 12);
    };
    tick();
    return () => clearTimeout(raf.current);
  }, [open]);

  const tokens = Math.round(THINKING.length / 0.62); // believable token count
  const streaming = open && shown < THINKING.length;

  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'baseline', gap: 7,
          background: 'transparent', border: 'none', borderRadius: 0,
          color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12.5,
          padding: 0, cursor: 'pointer', transition: 'all .18s',
        }}
      >
        <span style={{ color: 'var(--muted-dim)' }}>›</span>
        <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>/reasoning</span>
        <span style={{ color: 'var(--muted-dim)' }}>·</span>
        <span>{tokens.toLocaleString()} thinking tokens</span>
        <span style={{ color: 'var(--muted-dim)' }}>·</span>
        <span style={{ color: open ? 'var(--cyan)' : 'var(--muted-dim)', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: open ? 'var(--cyan)' : 'var(--line-strong)' }}>
          {open ? 'hide' : 'reveal'}
        </span>
        <span style={{
          display: 'inline-block', width: 7, height: 7, borderRadius: 2, alignSelf: 'center',
          background: active ? 'var(--cyan)' : 'var(--muted-dim)',
          boxShadow: active ? '0 0 8px var(--cyan)' : 'none',
        }} />
      </button>

      <div style={{ display: open ? 'block' : 'none' }}>
        <div style={{
            marginTop: 10, padding: '12px 14px',
            borderLeft: '2px solid var(--line-strong)',
            background: 'rgba(34,211,238,0.045)',
            borderRadius: '0 8px 8px 0',
            fontSize: 12.5, lineHeight: 1.72, fontStyle: 'italic',
            color: '#83a7b3', whiteSpace: 'pre-wrap',
          }}>
            {THINKING.slice(0, shown)}
            {streaming && <span className="blink" style={{ color: 'var(--cyan)', fontStyle: 'normal' }}>▋</span>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Live agent strip — scan → reason → verify
   ============================================================ */
const STAGES = [
  {
    key: 'SCAN', delay: 0,
    lines: [
      { kind: 'sub', t: 'mapping imports of src/auth.ts' },
      { kind: 'tool', t: 'read_file', meta: 'src/auth.ts · 142 lines · 4 callbacks' },
      { kind: 'tool', t: 'grep_symbol', meta: 'find all callers before the rewrite' },
      { kind: 'ok', t: 'mapped 2 files · 7 call sites', tail: 'stage complete' },
    ],
  },
  {
    key: 'REASON', delay: 1500,
    lines: [
      { kind: 'sub', t: 'planning the async/await conversion' },
      { kind: 'think' },
      { kind: 'ok', t: 'plan locked · 4 hunks + 1 test file', tail: 'converged' },
    ],
  },
  {
    key: 'VERIFY', delay: 3400,
    lines: [
      { kind: 'sub', t: 'host runs your test command — exit code is ground truth' },
      { kind: 'ok', t: '6 passed in 0.42s', tail: 'green' },
    ],
  },
];

function StageHeader({ name, active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0' }}>
      <span style={{
        color: active ? 'var(--cyan-bright)' : 'var(--cyan)', fontWeight: 700,
        fontSize: 13, letterSpacing: '0.04em',
        textShadow: active ? '0 0 10px rgba(34,211,238,0.5)' : 'none',
      }}>
        ={'='}[ {name} ]={'='}
      </span>
      <span style={{ color: 'var(--muted-dim)', fontSize: 12 }}>(๑•ᴗ•)ﻭ✎</span>
    </div>
  );
}

function Line({ l }) {
  if (l.kind === 'sub') {
    return (
      <div style={{ paddingLeft: 18, color: 'var(--muted)', fontSize: 12.5 }}>
        <span style={{ color: 'var(--muted-dim)' }}>- </span>{l.t}
      </div>
    );
  }
  if (l.kind === 'tool') {
    return (
      <div style={{ paddingLeft: 18, fontSize: 12.5 }}>
        <span style={{ color: 'var(--muted-dim)' }}>* </span>
        <span style={{ color: 'var(--sky)' }}>{l.t}</span>
        <span style={{ color: 'var(--muted)' }}>{'  '}{l.meta}</span>
      </div>
    );
  }
  if (l.kind === 'ok') {
    return (
      <div style={{ paddingLeft: 18, fontSize: 12.5 }}>
        <span style={{
          color: 'var(--green)', fontWeight: 700,
          background: 'rgba(52,211,153,0.12)', padding: '1px 6px', borderRadius: 5,
        }}>[OK]</span>{' '}
        <span style={{ color: '#cfeef4' }}>{l.t}</span>
        {l.tail && <span style={{ color: 'var(--muted-dim)' }}>{'  '}({l.tail})</span>}
      </div>
    );
  }
  return null;
}

function AgentStrip() {
  const [step, setStep] = useState(0); // global count of revealed lines
  const [runKey, setRunKey] = useState(0);

  // Flatten stages -> list of {stageIdx, line}
  const flat = [];
  STAGES.forEach((s, si) => s.lines.forEach(line => flat.push({ si, line })));

  useEffect(() => {
    setStep(0);
    const timers = [];
    let acc = 350;
    flat.forEach((_, i) => {
      // thinking line pauses a touch longer
      const isThink = flat[i].line.kind === 'think';
      acc += isThink ? 620 : 480;
      timers.push(setTimeout(() => setStep(i + 1), acc));
    });
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line
  }, [runKey]);

  const reasonActive = (() => {
    const idx = flat.findIndex(f => f.line.kind === 'think');
    return step > idx; // think line revealed
  })();
  const done = step >= flat.length;

  let lastStage = -1;

  return (
    <div style={{
      position: 'relative',
      background: 'transparent',
      padding: '2px 2px 4px',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12, paddingBottom: 11, borderBottom: '1px dashed rgba(56,189,248,0.28)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          <span style={{ color: 'var(--muted)', fontSize: 12.5, whiteSpace: 'nowrap', flexShrink: 0 }}>aether agent</span>
          <span style={{
            display: 'inline-flex', alignItems: 'baseline', gap: 6,
            fontFamily: 'var(--mono)', fontSize: 12,
          }}>
            <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>/opus</span>
            <span style={{ color: 'var(--muted-dim)' }}>*</span>
            <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>/effort</span>
            <span style={{ color: 'var(--muted)' }}>code-pro</span>
          </span>
          <span style={{ color: 'var(--muted-dim)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            refactor src/auth.ts → async/await + tests
          </span>
        </div>
        <button
          onClick={() => setRunKey(k => k + 1)}
          style={{
            flexShrink: 0, marginLeft: 12,
            background: 'rgba(34,211,238,0.10)', border: '1px solid var(--line-strong)',
            color: 'var(--cyan)', fontFamily: 'var(--mono)', fontSize: 11.5,
            borderRadius: 7, padding: '4px 11px', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >↻ replay</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: 232 }}>
        {flat.map((f, i) => {
          if (i >= step) return null;
          const showHeader = f.si !== lastStage;
          lastStage = f.si;
          const isLastRevealed = i === step - 1 && !done;
          return (
            <div key={i} className="agent-line">
              {showHeader && (
                <StageHeader name={STAGES[f.si].key} active={i >= step - 1 && !done} />
              )}
              {f.line.kind === 'think'
                ? <div style={{ paddingLeft: 18 }}><ThinkingPanel active={reasonActive && !done} /></div>
                : <Line l={f.line} />}
              {isLastRevealed && f.line.kind !== 'think' && (
                <span className="blink" style={{ color: 'var(--cyan)', paddingLeft: 18 }}>▋</span>
              )}
            </div>
          );
        })}
      </div>

      {/* context meter */}
      <div style={{
        marginTop: 14, paddingTop: 12, borderTop: '1px dashed rgba(56,189,248,0.28)',
        display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--muted)',
      }}>
        <span style={{ color: 'var(--muted-dim)', whiteSpace: 'nowrap' }}>anchoring context _ϕ(°-°=)</span>
        <div style={{ flex: 1, height: 9, borderRadius: 3, background: 'rgba(2,12,18,0.8)', border: '1px solid var(--line)', overflow: 'hidden' }}>
          <div style={{
            width: done ? '35.4%' : `${Math.min(35, step * 4)}%`, height: '100%',
            background: 'linear-gradient(90deg, #2dd6ee, #4ea8ff)',
            transition: 'width .5s ease', boxShadow: '0 0 10px rgba(34,211,238,0.6)',
          }} />
        </div>
        <span style={{ color: 'var(--cyan)', whiteSpace: 'nowrap' }}>412.6M / 1.17B</span>
      </div>

      <style>{`
        .agent-line { opacity: 1; }
      `}</style>
    </div>
  );
}

/* ============================================================
   Install cards
   ============================================================ */
const CARDS = [
  {
    n: '01', tag: 'INSTALL', Icon: IconInstall,
    title: 'Drop it in',
    sub: 'one global install · Node ≥ 24',
    lines: [
      { p: '$', cmd: 'npm i -g aether-agents' },
    ],
    foot: 'or curl install.sh · no native deps',
  },
  {
    n: '02', tag: 'HOSTED', Icon: IconCloud,
    title: 'Run on the fleet',
    sub: 'Claude · GPT · DeepSeek · Neo', 
    lines: [
      { p: '$', cmd: 'aether auth login' },
      { p: '$', cmd: 'aether agent ', arg: '"refactor src/auth.ts"' },
    ],
    foot: 'your code stays local — only context leaves',
  },
  {
    n: '03', tag: 'LOCAL', Icon: IconLocal,
    title: 'Go fully offline',
    sub: 'any Ollama model · no account or network',
    lines: [
      { p: '$', cmd: 'ollama pull qwen2.5-coder:7b' },
      { p: '$', cmd: 'aether agent --local ', arg: '"same task"' },
    ],
    foot: 'nothing leaves the machine',
  },
];

function InstallCard({ c }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        background: 'var(--panel)',
        border: `1px solid ${hover ? 'var(--line-strong)' : 'var(--line)'}`,
        borderRadius: 14, padding: '16px 15px 14px',
        display: 'flex', flexDirection: 'column', gap: 11,
        transform: hover ? 'translateY(-4px)' : 'none',
        boxShadow: hover ? '0 18px 44px -22px rgba(34,211,238,0.5)' : '0 10px 30px -26px rgba(0,0,0,0.8)',
        transition: 'transform .22s ease, box-shadow .22s ease, border-color .22s ease',
        overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: 'linear-gradient(90deg, transparent, var(--cyan), transparent)',
        opacity: hover ? 0.9 : 0.4, transition: 'opacity .22s',
      }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ color: 'var(--cyan)', display: 'flex' }}><c.Icon /></span>
          <span style={{
            fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--cyan)', fontWeight: 700,
          }}>{c.tag}</span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted-dim)', fontWeight: 700 }}>{c.n}</span>
      </div>

      <div>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', color: '#eafafe', marginBottom: 3 }}>{c.title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>{c.sub}</div>
      </div>

      <CommandBlock lines={c.lines} />

      <div style={{
        marginTop: 'auto', paddingTop: 4, fontSize: 11.5, color: 'var(--muted-dim)',
        display: 'flex', alignItems: 'center', gap: 7,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--green)', flexShrink: 0 }} />
        {c.foot}
      </div>
    </div>
  );
}

/* ============================================================
   App
   ============================================================ */
function App() {
  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      {/* window chrome card */}
      <div style={{
        background: 'linear-gradient(180deg, rgba(6,24,32,0.78), rgba(3,15,21,0.82))',
        border: '1px solid var(--line)', borderRadius: 20,
        boxShadow: '0 40px 120px -50px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.03)',
        overflow: 'hidden',
      }}>
        {/* title bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '13px 18px', borderBottom: '1px solid var(--line)',
          background: 'rgba(2,12,18,0.5)',
        }}>
          <span style={{ width: 12, height: 12, borderRadius: 999, background: '#ff5f57' }} />
          <span style={{ width: 12, height: 12, borderRadius: 999, background: '#febc2e' }} />
          <span style={{ width: 12, height: 12, borderRadius: 999, background: '#28c840' }} />
          <span style={{ marginLeft: 12, color: 'var(--muted)', fontSize: 12.5, letterSpacing: '0.04em' }}>
            aether agent — coding session
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--muted-dim)', fontSize: 12 }}>v0.1.0</span>
        </div>

        {/* clean header — cloud + AETHER as one unit inside the terminal */}
        <div style={{
          padding: 'clamp(26px, 3.6vw, 44px) clamp(20px, 3.6vw, 44px) clamp(18px, 2.4vw, 28px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
          borderBottom: '1px dashed rgba(56,189,248,0.28)',
          background: 'radial-gradient(620px 220px at 50% 0%, rgba(34,211,238,0.09), transparent 70%)',
        }}>
          <CloudAgent />
          <div style={{ overflow: 'visible', marginTop: 14, padding: '0 6px' }}><AetherLogo /></div>
          <p style={{
            margin: '18px auto 0', maxWidth: 700,
            fontFamily: 'var(--sans)', fontSize: 15.5, lineHeight: 1.72, fontWeight: 400,
            letterSpacing: '0.01em', color: '#9fc0cc', textWrap: 'pretty',
          }}>
            An open-source coding agent for your terminal — <span style={{ color: 'var(--sky)', fontWeight: 500 }}>cloud</span> or <span style={{ color: 'var(--cyan)', fontWeight: 500 }}>--local</span>.
            It scans, plans, edits, and runs your tests on its own.
            <span style={{ color: '#d6eef4' }}> And with <span style={{ color: 'var(--cyan)', fontWeight: 500 }}>QOPC</span> 🧠 it learns from what you accept or discard — getting better the more you use it.</span>
          </p>
        </div>

        {/* live agent strip */}
        <div style={{ padding: 'clamp(20px, 3vw, 30px) clamp(20px, 3.6vw, 44px) 0' }}>
          <AgentStrip />
        </div>

        {/* install cards */}
        <div style={{ padding: 'clamp(22px, 3vw, 32px) clamp(20px, 3.6vw, 44px) clamp(26px, 3.6vw, 42px)', borderTop: '1px dashed rgba(56,189,248,0.28)' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: '#eafafe' }}>Install in three moves</div>
            <div style={{ color: 'var(--muted-dim)', fontSize: 12.5, marginTop: 6 }}>
              pick a brain — hosted or local, both behave identically
            </div>
          </div>
          <div style={{
            display: 'grid', gap: 14,
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          }} className="card-grid">
            {CARDS.map(c => <InstallCard key={c.n} c={c} />)}
          </div>

          <a
            href="https://github.com/shinshin86/oh-my-logo"
            target="_blank"
            rel="noopener noreferrer"
            className="gh-bar"
            style={{
              display: 'flex', alignItems: 'center', gap: 14, marginTop: 16,
              padding: '13px 18px', textDecoration: 'none',
              background: 'rgba(2,12,18,0.55)',
              border: '1px solid var(--line)', borderRadius: 12,
              transition: 'border-color .2s, background .2s, transform .2s',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--text)" style={{ flexShrink: 0 }}>
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em', color: '#eafafe' }}>View the source on GitHub</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
                star it, fork it, ship it
              </div>
            </div>
            <span style={{
              display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
              fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--cyan)',
              border: '1px solid var(--line-strong)', borderRadius: 8, padding: '6px 12px',
            }}>
              github.com<span style={{ color: 'var(--muted-dim)' }}>→</span>
            </span>
          </a>
        </div>

        <ModelsSection />
        <CommandsSection />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
