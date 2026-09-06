import { type PointerEvent, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Command,
  Expand,
  Keyboard,
  Laptop,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MonitorUp,
  MousePointer2,
  Power,
  RotateCcw,
  Server,
  Settings2,
  ShieldCheck,
  Terminal,
  Unplug,
  Wifi,
  Zap,
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { localVncUrl, RfbClient, type VncSnapshot } from './vnc-client';

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';
type Accent = 'amber' | 'coral' | 'mint';
type LogKind = 'system' | 'success' | 'warn' | 'info';

type EventLog = {
  time: string;
  message: string;
  detail?: string;
  kind: LogKind;
};

const queryClient = new QueryClient();

const accentOptions: { id: Accent; label: string; color: string }[] = [
  { id: 'amber', label: 'Amber relay', color: '#f8c65a' },
  { id: 'coral', label: 'Coral relay', color: '#f18c77' },
  { id: 'mint', label: 'Mint relay', color: '#63d5ad' },
];

const initialLogs: EventLog[] = [
  { time: '09:41:02', message: 'Bridge endpoint discovered', detail: '127.0.0.1:6080', kind: 'success' },
  { time: '09:41:02', message: 'Waiting for XFCE session', detail: 'display :0', kind: 'system' },
  { time: '09:41:03', message: 'WebSocket transport ready', detail: 'binary / local', kind: 'info' },
];

function nowStamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function IconButton({
  label,
  active = false,
  onClick,
  children,
  disabled = false,
  testId,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex h-9 w-9 items-center justify-center rounded-md border transition-all duration-200 ${
        active
          ? 'border-primary/50 bg-primary/12 text-primary'
          : 'border-transparent text-muted-foreground hover:border-border hover:bg-white/[.045] hover:text-foreground'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      {children}
    </button>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const live = status === 'connected';
  const pending = status === 'connecting';
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
      {(live || pending) && <span className={`absolute inset-0 rounded-full ${live ? 'bg-accent' : 'bg-primary'} status-pulse`} />}
      <span className={`relative h-1.5 w-1.5 rounded-full ${live ? 'bg-accent' : pending ? 'bg-primary' : status === 'error' ? 'bg-destructive' : 'bg-muted-foreground/60'}`} />
    </span>
  );
}

function BrandMark() {
  return (
    <div className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-primary/35 bg-primary/10 text-primary shadow-[0_0_24px_hsl(var(--primary)/.12)]">
      <Server size={17} strokeWidth={1.8} />
      <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
    </div>
  );
}

function RemoteDesktop({
  status,
  pointerEnabled,
  keyboardEnabled,
  canvasRef,
  onPointer,
}: {
  status: ConnectionStatus;
  pointerEnabled: boolean;
  keyboardEnabled: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onPointer: (event: PointerEvent<HTMLCanvasElement>) => void;
}) {
  const booting = status === 'connecting' || status === 'idle';
  const errored = status === 'error';
  return (
    <div data-testid="remote-desktop-surface" className="relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-white/[.1] bg-[#0c1116] shadow-[0_28px_70px_rgba(0,0,0,.34)] sm:aspect-[16/9]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(49,91,99,.32),transparent_29%),linear-gradient(140deg,#10191b,#17262a_52%,#0c1216)]" />
      <div className="absolute inset-0 opacity-30 desktop-grid" />
      <div className="absolute left-[12%] top-[20%] h-48 w-48 rounded-full border border-[#b6c99a]/15 shadow-[0_0_80px_rgba(99,155,130,.12)]" />
      <div className="absolute right-[11%] top-[15%] h-28 w-28 rounded-full border border-[#efbd69]/15" />

      <AnimatePresence mode="wait">
        {booting && (
          <motion.div key="boot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center p-5">
            <div className="w-full max-w-[470px]">
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <MonitorUp size={20} />
                </div>
                <div>
                  <p className="display-mono text-[10px] uppercase tracking-[.22em] text-primary/80">XFCE :0</p>
                  <h2 className="mt-1 text-lg font-bold tracking-[-.025em] text-foreground">{status === 'connecting' ? 'Negotiating session' : 'Desktop bridge on standby'}</h2>
                </div>
              </div>
              <div className="overflow-hidden rounded-md border border-white/[.1] bg-black/25 p-4 font-mono text-[11px] leading-6 text-[#b0c3b8]">
                <div className="mb-2 flex items-center justify-between border-b border-white/[.08] pb-2 text-[10px] uppercase tracking-[.15em] text-muted-foreground">
                  <span>machine output</span><span className="text-primary/80">{status === 'connecting' ? 'active' : 'standby'}</span>
                </div>
                <div className="text-[#8eaaa0]">$ xfce-session --display :0</div>
                <div>→ bridge handshake {status === 'connecting' ? 'in progress' : 'awaiting operator'}</div>
                <div className="text-[#8eaaa0]">→ transport: websocket / binary</div>
                <div className="flex items-center gap-2 text-[#8eaaa0]">→ compositor {status === 'connecting' ? 'starting' : 'ready'} <span className="inline-flex gap-0.5"><i className="h-1 w-1 rounded-full bg-accent" /><i className="h-1 w-1 rounded-full bg-accent/70" /><i className="h-1 w-1 rounded-full bg-accent/40" /></span></div>
                {status === 'connecting' && <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-white/[.08]"><div className="boot-scan h-full w-1/3 rounded-full bg-primary" /></div>}
              </div>
              <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">local-only session · no remote exposure</p>
            </div>
          </motion.div>
        )}
        {errored && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center p-5 text-center">
            <div className="max-w-sm">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-destructive/35 bg-destructive/10 text-destructive"><Unplug size={20} /></div>
              <h2 className="text-lg font-bold">Bridge did not answer</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">The local WebSocket is not accepting sessions yet. Check the bridge process, then try the handshake again.</p>
            </div>
          </motion.div>
        )}
        {status === 'connected' && (
          <motion.div key="desktop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .55 }} className="absolute inset-0">
            <canvas
              ref={canvasRef}
              data-testid="live-vnc-canvas"
              className="absolute inset-0 z-20 h-full w-full bg-[#161d24] object-contain"
              onPointerMove={onPointer}
              onPointerDown={onPointer}
              onPointerUp={onPointer}
            />
            <div className="absolute inset-x-0 top-0 flex h-7 items-center justify-between bg-[#10191a]/90 px-3 text-[9px] text-[#c1d0c3]">
              <div className="flex items-center gap-3"><span className="font-semibold tracking-[.16em]">APPLICATIONS</span><span className="text-[#8fa19a]">PLACES</span></div>
              <div className="flex items-center gap-3 font-mono text-[#9ab1a5]"><Wifi size={10} /> 09:41 <span className="h-1 w-1 rounded-full bg-accent" /></div>
            </div>
            <div className="absolute left-[8%] top-[21%] flex flex-col items-center gap-2 text-center text-[9px] text-[#d2ded3]"><div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-black/20"><Laptop size={20} /></div><span>Home</span></div>
            <div className="absolute left-1/2 top-1/2 w-[56%] max-w-[580px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-[#b8d2bd]/25 bg-[#11191b]/95 shadow-[0_24px_60px_rgba(0,0,0,.4)]">
              <div className="flex h-7 items-center justify-between border-b border-white/10 bg-[#243331] px-3 text-[9px] text-[#cedbd1]"><span className="font-semibold">operator@xfce-node: ~</span><div className="flex gap-1.5"><i className="h-2 w-2 rounded-full bg-[#dfbd63]" /><i className="h-2 w-2 rounded-full bg-[#7db894]" /><i className="h-2 w-2 rounded-full bg-[#d7786b]" /></div></div>
              <div className="p-4 font-mono text-[10px] leading-5 text-[#b5ccb9] sm:p-6 sm:text-[11px]"><div className="text-[#e4c477]">operator@xfce-node</div><div>────────────────────────────</div><div className="text-[#8fc6a1]">system online · session attached</div><div className="mt-3 text-[#a5bdb0]">Last login: today on pts/0</div><div className="mt-2"><span className="text-[#dfbf75]">$</span> top --sort=cpu</div><div className="text-[#81988b]">Tasks: 184 · load: 0.18 · uptime: 02:14:36</div><div className="mt-3 flex items-center gap-1"><span className="text-[#dfbf75]">$</span><span className="inline-block h-3 w-1.5 bg-[#dfbf75]" /></div></div>
            </div>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-[#172321]/90 p-1.5 shadow-xl backdrop-blur-sm"><div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#c78d4e] text-[#16201c]"><Terminal size={14} /></div><div className="h-6 w-px bg-white/10" /><div className="h-7 w-7 rounded-md bg-[#4e7064]/70" /><div className="h-7 w-7 rounded-md bg-[#706247]/70" /></div>
            <div className="absolute bottom-3 right-3 rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[9px] text-[#abc0b0]">{pointerEnabled ? 'pointer linked' : 'pointer paused'} · {keyboardEnabled ? 'keys linked' : 'keys paused'}</div>
            <div className="absolute right-3 top-3 z-30 rounded border border-accent/30 bg-[#08100d]/80 px-2 py-1 font-mono text-[9px] uppercase tracking-[.12em] text-accent backdrop-blur-sm">live RFB stream</div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-50" />
    </div>
  );
}

function Telemetry({ status, tick }: { status: ConnectionStatus; tick: number }) {
  const values = status === 'connected'
    ? [{ label: 'FPS', value: `${58 + (tick % 3)}`, suffix: 'fps', tone: 'text-accent' }, { label: 'LATENCY', value: `${11 + (tick % 4)}`, suffix: 'ms', tone: 'text-primary' }, { label: 'RESOLUTION', value: '1920×1080', suffix: '', tone: 'text-foreground' }, { label: 'TRANSPORT', value: 'WS / BIN', suffix: '', tone: 'text-foreground' }]
    : [{ label: 'FPS', value: '—', suffix: 'fps', tone: 'text-muted-foreground' }, { label: 'LATENCY', value: '—', suffix: 'ms', tone: 'text-muted-foreground' }, { label: 'RESOLUTION', value: '—', suffix: '', tone: 'text-muted-foreground' }, { label: 'TRANSPORT', value: 'LOCAL', suffix: '', tone: 'text-primary' }];
  return (
    <div data-testid="telemetry-strip" className="grid grid-cols-2 divide-x divide-y divide-border/70 rounded-lg border border-border/80 bg-card/70 sm:grid-cols-4 sm:divide-y-0">
      {values.map((item) => <div key={item.label} className="px-4 py-3.5"><p className="display-mono text-[9px] tracking-[.16em] text-muted-foreground">{item.label}</p><p className={`mt-1.5 display-mono text-[14px] font-medium ${item.tone}`}>{item.value}<span className="ml-1 text-[10px] text-muted-foreground">{item.suffix}</span></p></div>)}
    </div>
  );
}

function AppHome() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [logs, setLogs] = useState<EventLog[]>(initialLogs);
  const [pointerEnabled, setPointerEnabled] = useState(true);
  const [keyboardEnabled, setKeyboardEnabled] = useState(true);
  const [fitMode, setFitMode] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [accent, setAccent] = useState<Accent>(() => (localStorage.getItem('xfce-vnc-accent') as Accent) || 'amber');
  const [showPalette, setShowPalette] = useState(false);
  const [tick, setTick] = useState(0);
  const [vncSnapshot, setVncSnapshot] = useState<VncSnapshot>({
    phase: 'idle',
    width: 0,
    height: 0,
    lastFrameAt: null,
    message: 'Bridge idle',
  });
  const desktopRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vncRef = useRef<RfbClient | null>(null);

  const selectedAccent = useMemo(() => accentOptions.find((item) => item.id === accent) ?? accentOptions[0], [accent]);

  const addLog = useCallback((message: string, kind: LogKind, detail?: string) => {
    setLogs((current) => [...current.slice(-5), { time: nowStamp(), message, detail, kind }]);
  }, []);

  const connect = useCallback(() => {
    if (status === 'connecting' || status === 'connected') return;
    setStatus('connecting');
    addLog('Opening local bridge', 'info', localVncUrl());
    vncRef.current?.connect(localVncUrl());
  }, [addLog, status]);

  const disconnect = useCallback(() => {
    vncRef.current?.disconnect();
    setStatus('idle');
    addLog('Session released', 'warn', 'bridge remains available');
  }, [addLog]);

  const handlePointer = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    if (!pointerEnabled || !canvasRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const buttons = event.buttons || (event.type === 'pointerup' ? 0 : 1);
    vncRef.current?.sendPointer(
      (event.clientX - rect.left) * scaleX,
      (event.clientY - rect.top) * scaleY,
      buttons,
    );
  }, [pointerEnabled]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      desktopRef.current?.requestFullscreen?.();
      setFullscreen(true);
      addLog('Desktop expanded', 'system', 'fullscreen surface');
    } else {
      document.exitFullscreen?.();
      setFullscreen(false);
      addLog('Desktop restored', 'system', 'windowed surface');
    }
  }, [addLog]);

  const togglePointer = useCallback(() => {
    setPointerEnabled((value) => !value);
    addLog(`Pointer ${pointerEnabled ? 'paused' : 'linked'}`, pointerEnabled ? 'warn' : 'success');
  }, [addLog, pointerEnabled]);

  const toggleKeyboard = useCallback(() => {
    setKeyboardEnabled((value) => !value);
    addLog(`Keyboard ${keyboardEnabled ? 'paused' : 'linked'}`, keyboardEnabled ? 'warn' : 'success');
  }, [addLog, keyboardEnabled]);

  useEffect(() => {
    const client = new RfbClient();
    vncRef.current = client;
    client.attachCanvas(canvasRef.current);
    const unsubscribe = client.subscribe((snapshot) => {
      setVncSnapshot(snapshot);
      if (snapshot.phase === 'connected') {
        setStatus('connected');
        addLog('XFCE session attached', 'success', `display :99 · ${snapshot.width}×${snapshot.height}`);
        addLog('Input channels enabled', 'system', 'keyboard · pointer');
      } else if (snapshot.phase === 'connecting' || snapshot.phase === 'handshaking') {
        setStatus('connecting');
      } else if (snapshot.phase === 'error') {
        setStatus('error');
        addLog('Bridge handshake failed', 'warn', snapshot.message);
      } else if (snapshot.phase === 'closed') {
        setStatus('idle');
      }
    });
    return () => {
      unsubscribe();
      client.disconnect();
      vncRef.current = null;
    };
  }, [addLog]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    localStorage.setItem('xfce-vnc-accent', accent);
  }, [accent]);

  useEffect(() => {
    if (status !== 'connected') return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1600);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    window.xfceWebVnc = { connect, disconnect, status: () => status, sendCtrlAltDel: () => addLog('Control sequence sent', 'info', 'ctrl + alt + del') };
    return () => { delete window.xfceWebVnc; };
  }, [addLog, connect, disconnect, status]);

  return (
    <main className="machine-shell min-h-[100dvh] overflow-hidden">
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1520px] flex-col px-4 pb-6 sm:px-6 lg:px-8">
        <header className="flex h-[76px] shrink-0 items-center justify-between border-b fine-rule">
          <div className="flex items-center gap-3.5">
            <BrandMark />
            <div><p className="text-[15px] font-extrabold tracking-[-.04em]">relay<span className="text-primary">/</span>xfce</p><p className="display-mono mt-0.5 text-[9px] uppercase tracking-[.18em] text-muted-foreground">local desktop console</p></div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <button type="button" data-testid="button-accent-menu" onClick={() => setShowPalette((value) => !value)} className="flex h-9 items-center gap-2 rounded-md border border-transparent px-2.5 text-xs text-muted-foreground transition hover:border-border hover:text-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ background: selectedAccent.color }} /><span className="hidden sm:inline">{selectedAccent.label}</span><ChevronDown size={13} /></button>
              <AnimatePresence>
                {showPalette && <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="absolute right-0 top-11 z-20 w-44 overflow-hidden rounded-lg border border-border bg-popover p-1.5 shadow-xl"><p className="px-2 py-1.5 display-mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">signal color</p>{accentOptions.map((option) => <button type="button" data-testid={`button-accent-${option.id}`} key={option.id} onClick={() => { setAccent(option.id); setShowPalette(false); }} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-white/[.05] hover:text-foreground"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ background: option.color }} />{option.label}</span>{accent === option.id && <Check size={13} className="text-primary" />}</button>)}</motion.div>}
              </AnimatePresence>
            </div>
            <div className="hidden h-5 w-px bg-border sm:block" />
            <div data-testid="status-header" className="flex items-center gap-2 display-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground"><StatusDot status={status} /><span className={status === 'connected' ? 'text-accent' : status === 'error' ? 'text-destructive' : ''}>{status === 'connected' ? 'session live' : status === 'connecting' ? 'connecting' : status === 'error' ? 'bridge error' : 'standby'}</span></div>
          </div>
        </header>

        <section className="flex flex-col gap-6 py-7 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="mb-3 flex items-center gap-2 display-mono text-[10px] uppercase tracking-[.18em] text-primary"><span className="h-px w-7 bg-primary" /> machine room / 01</div><h1 className="max-w-2xl text-[clamp(2rem,4vw,3.7rem)] font-extrabold leading-[1.02] tracking-[-.065em] text-foreground">A direct line to<br /><span className="text-primary">your local desktop.</span></h1><p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">Open an XFCE session without leaving the browser. The bridge stays local, the operator stays in control.</p></div>
          <div className="flex items-center gap-2 lg:pb-1">
            {status === 'connected' ? <button type="button" data-testid="button-disconnect" onClick={disconnect} className="flex h-10 items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 text-xs font-semibold text-destructive transition hover:bg-destructive/15"><Power size={14} /> Disconnect</button> : <button type="button" data-testid="button-connect" onClick={connect} disabled={status === 'connecting'} className="flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-xs font-bold text-primary-foreground shadow-[0_8px_24px_hsl(var(--primary)/.16)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_30px_hsl(var(--primary)/.22)] disabled:cursor-wait disabled:opacity-70"><Zap size={14} className={status === 'connecting' ? 'animate-pulse' : ''} /> {status === 'connecting' ? 'Connecting…' : 'Connect to desktop'}</button>}
            <button type="button" data-testid="button-help" onClick={() => addLog('Operator reference opened', 'info', 'bridge controls documented')} className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-white/[.04] hover:text-foreground" aria-label="Open operator help"><CircleHelp size={16} /></button>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
          <section className="min-w-0 space-y-3">
            <div className="flex items-center justify-between px-0.5"><div className="flex items-center gap-2.5"><div className="flex items-center gap-2"><StatusDot status={status} /><span className="text-xs font-semibold">{status === 'connected' ? 'XFCE desktop' : 'Remote desktop'}</span></div><span className="display-mono text-[10px] text-muted-foreground">/ display :0</span></div><div className="flex items-center gap-1"><IconButton label="Fit desktop to view" active={fitMode} onClick={() => { setFitMode((value) => !value); addLog(`Fit to view ${fitMode ? 'disabled' : 'enabled'}`, 'system'); }} testId="button-fit"><Expand size={15} /></IconButton><IconButton label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} active={fullscreen} onClick={toggleFullscreen} testId="button-fullscreen">{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</IconButton></div></div>
            <div ref={desktopRef} className="rounded-xl border border-border/70 bg-[#0c1116] p-1.5 sm:p-2"><RemoteDesktop status={status} pointerEnabled={pointerEnabled} keyboardEnabled={keyboardEnabled} canvasRef={canvasRef} onPointer={handlePointer} /></div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/55 px-2 py-1.5"><div className="flex items-center gap-0.5"><IconButton label={keyboardEnabled ? 'Disable keyboard input' : 'Enable keyboard input'} active={keyboardEnabled} onClick={toggleKeyboard} testId="button-keyboard"><Keyboard size={15} /></IconButton><IconButton label={pointerEnabled ? 'Disable pointer input' : 'Enable pointer input'} active={pointerEnabled} onClick={togglePointer} testId="button-pointer"><MousePointer2 size={15} /></IconButton><IconButton label="Send Ctrl Alt Delete" onClick={() => addLog('Control sequence sent', 'info', 'ctrl + alt + del')} testId="button-ctrl-alt-del"><Command size={15} /></IconButton><IconButton label="Copy bridge address" onClick={() => { void navigator.clipboard?.writeText('ws://127.0.0.1:6080'); addLog('Bridge address copied', 'success', 'clipboard ready'); }} testId="button-copy-address"><Clipboard size={15} /></IconButton></div><div className="flex items-center gap-2 px-2 display-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground"><LockKeyhole size={12} className="text-accent" /> local transport only</div></div>
            <Telemetry status={status} tick={tick} />
          </section>

          <aside className="flex min-h-0 flex-col gap-4">
            <div className="glass-panel rounded-lg p-4">
              <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><Activity size={15} className="text-primary" /><h2 className="text-xs font-bold">Session diagnostics</h2></div><span className="display-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">live</span></div>
              <div className="space-y-3.5">
                <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Bridge endpoint</span><span className="display-mono text-[10px] text-foreground">127.0.0.1:6080</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Session</span><span className="flex items-center gap-1.5 display-mono text-[10px] text-accent"><StatusDot status={status} />{status === 'connected' ? 'attached' : 'not attached'}</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Display</span><span className="display-mono text-[10px] text-foreground">:99 / XFCE</span></div>
                <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Security</span><span className="flex items-center gap-1.5 display-mono text-[10px] text-accent"><ShieldCheck size={12} /> loopback</span></div>
              </div>
              <div className="mt-5 flex items-end justify-between border-t border-border/70 pt-4"><div><p className="display-mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">signal</p><div className="mt-2 flex h-4 items-end gap-1"><i className={`signal-bar h-1.5 w-1 rounded-sm ${status === 'connected' ? 'bg-accent' : 'bg-muted-foreground/50'}`} /><i className={`signal-bar h-2.5 w-1 rounded-sm ${status === 'connected' ? 'bg-accent' : 'bg-muted-foreground/50'}`} /><i className={`signal-bar h-3.5 w-1 rounded-sm ${status === 'connected' ? 'bg-accent' : 'bg-muted-foreground/50'}`} /><i className={`signal-bar h-4 w-1 rounded-sm ${status === 'connected' ? 'bg-accent' : 'bg-muted-foreground/50'}`} /></div></div><span className="display-mono text-[10px] text-accent">{status === 'connected' ? 'strong' : 'quiet'}</span></div>
            </div>

            <div className="glass-panel flex min-h-[260px] flex-1 flex-col rounded-lg p-4">
              <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Terminal size={14} className="text-primary" /><h2 className="text-xs font-bold">Machine events</h2></div><button type="button" data-testid="button-clear-events" onClick={() => setLogs([])} className="display-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground transition hover:text-foreground">clear</button></div>
              <div data-testid="event-log" className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
                {logs.length === 0 ? <div className="flex h-full min-h-[190px] flex-col items-center justify-center text-center"><RotateCcw size={17} className="mb-3 text-muted-foreground/50" /><p className="text-xs text-muted-foreground">No machine events yet</p><p className="mt-1 text-[10px] text-muted-foreground/70">New bridge activity will appear here.</p></div> : logs.map((log, index) => <motion.div initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} key={`${log.time}-${log.message}-${index}`} className="relative pl-4"><span className={`absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full ${log.kind === 'success' ? 'bg-accent' : log.kind === 'warn' ? 'bg-primary' : log.kind === 'info' ? 'bg-chart-4' : 'bg-muted-foreground'}`} /><div className="flex items-baseline justify-between gap-2"><p className="text-[11px] leading-4 text-foreground/85">{log.message}</p><time className="shrink-0 display-mono text-[9px] text-muted-foreground/70">{log.time}</time></div>{log.detail && <p className="mt-0.5 display-mono text-[9px] text-muted-foreground">{log.detail}</p>}</motion.div>)}
              </div>
              <div className="mt-4 border-t border-border/70 pt-3"><p className="display-mono text-[9px] leading-4 text-muted-foreground"><span className="text-primary">note:</span> event history is local to this browser tab.</p></div>
            </div>
          </aside>
        </div>

        <footer className="mt-5 flex flex-col gap-2 border-t fine-rule pt-4 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> all systems local</span><span className="hidden h-3 w-px bg-border sm:block" /><span className="display-mono">relay v0.8.4</span></div><div className="flex items-center gap-2"><Settings2 size={12} /><span>bridge preferences</span><ArrowDownToLine size={12} className="ml-2" /><span>no cloud relay</span></div></footer>
      </div>
    </main>
  );
}

declare global {
  interface Window {
    xfceWebVnc?: {
      connect: () => void;
      disconnect: () => void;
      status: () => ConnectionStatus;
      sendCtrlAltDel: () => void;
    };
  }
}

function Router() {
  return <Switch><Route path="/" component={AppHome} /><Route component={NotFound} /></Switch>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedErrorBoundary><Router /></RoutedErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;