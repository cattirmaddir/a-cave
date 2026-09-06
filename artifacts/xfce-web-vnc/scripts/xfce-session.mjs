import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';

const display = process.env.XFCE_DISPLAY ?? ':99';
const displayNumber = display.replace(':', '');
const width = process.env.XFCE_WIDTH ?? '1440';
const height = process.env.XFCE_HEIGHT ?? '860';
const depth = process.env.XFCE_DEPTH ?? '24';
const vncPort = Number(process.env.XFCE_VNC_PORT ?? '5900');
const wsPort = Number(process.env.XFCE_WS_PORT ?? '6080');
const home = process.env.HOME ?? '/tmp';
const runtimeDir = join(home, '.xfce-web-vnc');
const xfceConfig = join(runtimeDir, 'config');

mkdirSync(runtimeDir, { recursive: true });
mkdirSync(xfceConfig, { recursive: true });
const localDbusConfig = join(runtimeDir, 'session.conf');
writeFileSync(
  localDbusConfig,
  `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:tmpdir=${runtimeDir}</listen>
  <policy context="default">
    <allow send_destination="*"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`,
);

const children = [];
let shuttingDown = false;

function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DISPLAY: display,
      XDG_CONFIG_HOME: xfceConfig,
      XDG_RUNTIME_DIR: runtimeDir,
      LIBGL_ALWAYS_SOFTWARE: '1',
      ...options.env,
    },
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${command}] ${chunk}`));
  child.on('error', (error) => {
    console.error(`[xfce-session] failed to start ${command}: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[xfce-session] ${command} exited (${code ?? signal})`);
    }
  });
  children.push(child);
  return child;
}

function commandPath(command) {
  try {
    return execFileSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).trim();
  } catch {
    return command;
  }
}

function stopAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.reverse()) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL');
    }
    process.exit(0);
  }, 1200).unref();
}

function waitForCommand(command, args, timeout = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const probe = spawn(command, args, { stdio: 'ignore' });
      probe.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else if (Date.now() - startedAt >= timeout) {
          reject(new Error(`${command} did not become ready in time`));
        } else {
          setTimeout(check, 100).unref();
        }
      });
      probe.on('error', () => {
        if (Date.now() - startedAt >= timeout) {
          reject(new Error(`${command} is unavailable`));
        } else {
          setTimeout(check, 100).unref();
        }
      });
    };
    check();
  });
}

function waitForPort(port, timeout = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeout) {
          reject(new Error(`port ${port} did not become ready in time`));
        } else {
          setTimeout(check, 100).unref();
        }
      });
    };
    check();
  });
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
process.on('exit', stopAll);

console.log(`[xfce-session] starting virtual display ${display} at ${width}x${height}`);
spawnLogged('Xvfb', [
  display,
  '-screen',
  '0',
  `${width}x${height}x${depth}`,
  '-ac',
  '+extension',
  'RANDR',
  '+extension',
  'MIT-SHM',
  '-nolisten',
  'tcp',
]);

async function startSession() {
  await waitForCommand('xdpyinfo', ['-display', display]);

  console.log('[xfce-session] starting XFCE desktop');
  const dbusRunSession = commandPath('dbus-run-session');
  const dbusDaemon = commandPath('dbus-daemon');
  const session = existsSync(localDbusConfig)
    ? [
        dbusRunSession,
        [
          '--dbus-daemon',
          dbusDaemon,
          '--config-file',
          localDbusConfig,
          '--',
          'xfce4-session',
        ],
      ]
    : ['xfce4-session', []];
  spawnLogged(session[0], session[1]);

  console.log(`[xfce-session] starting x11vnc on port ${vncPort}`);
  spawnLogged('x11vnc', [
    '-display',
    display,
    '-rfbport',
    String(vncPort),
    '-localhost',
    '-nopw',
    '-forever',
    '-shared',
    '-repeat',
    '-wait',
    '5',
  ]);
  await waitForPort(vncPort);

  const websockify = join(process.cwd(), '.pythonlibs', 'bin', 'websockify');
  console.log(`[xfce-session] bridging WebSocket :${wsPort} -> RFB :${vncPort}`);
  spawnLogged(existsSync(websockify) ? websockify : 'websockify', [
    '--web',
    join(process.cwd(), 'artifacts', 'xfce-web-vnc', 'public'),
    String(wsPort),
    `localhost:${vncPort}`,
  ]);
}

startSession().catch((error) => {
  console.error(`[xfce-session] startup failed: ${error.message}`);
  stopAll();
});
