export type VncPhase =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'error'
  | 'closed';

export type VncSnapshot = {
  phase: VncPhase;
  width: number;
  height: number;
  lastFrameAt: number | null;
  message: string;
};

type Listener = (snapshot: VncSnapshot) => void;

const concatBytes = (left: Uint8Array, right: Uint8Array) => {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
};

const readUint16 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] << 8) | bytes[offset + 1];

const readUint32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>>
  0;

const writeUint16 = (view: DataView, offset: number, value: number) =>
  view.setUint16(offset, value, false);

const writeUint32 = (view: DataView, offset: number, value: number) =>
  view.setUint32(offset, value, false);

export class RfbClient {
  private socket: WebSocket | null = null;
  private buffer = new Uint8Array();
  private phase: VncPhase = 'idle';
  private state: 'version' | 'security' | 'security-result' | 'server-init' | 'updates' =
    'version';
  private protocolVersion = '3.8';
  private listeners = new Set<Listener>();
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private snapshot: VncSnapshot = {
    phase: 'idle',
    width: 0,
    height: 0,
    lastFrameAt: null,
    message: 'Bridge idle',
  };

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  attachCanvas(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.context = canvas?.getContext('2d', { alpha: false }) ?? null;
  }

  connect(url: string) {
    this.disconnect();
    this.buffer = new Uint8Array();
    this.state = 'version';
    this.update({ phase: 'connecting', message: 'Opening local bridge…' });

    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      this.update({ phase: 'handshaking', message: 'Negotiating RFB 3.8…' });
    };
    socket.onmessage = (event) => {
      const chunk =
        typeof event.data === 'string'
          ? new TextEncoder().encode(event.data)
          : new Uint8Array(event.data);
      this.buffer = concatBytes(this.buffer, chunk);
      this.process();
    };
    socket.onerror = () => {
      this.update({ phase: 'error', message: 'The local bridge is not ready yet.' });
    };
    socket.onclose = () => {
      if (this.phase !== 'error') this.update({ phase: 'closed', message: 'Bridge closed' });
    };
    this.socket = socket;
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
    if (this.phase !== 'idle') this.update({ phase: 'closed', message: 'Disconnected' });
  }

  sendPointer(x: number, y: number, buttons = 0) {
    if (this.phase !== 'connected') return;
    const bytes = new Uint8Array(6);
    const view = new DataView(bytes.buffer);
    bytes[0] = 5;
    bytes[1] = buttons;
    writeUint16(view, 2, Math.max(0, Math.round(x)));
    writeUint16(view, 4, Math.max(0, Math.round(y)));
    this.send(bytes);
  }

  sendKey(key: number, down: boolean) {
    if (this.phase !== 'connected') return;
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    bytes[0] = 4;
    bytes[1] = down ? 1 : 0;
    writeUint32(view, 4, key);
    this.send(bytes);
  }

  requestFullFrame() {
    if (this.phase !== 'connected') return;
    const bytes = new Uint8Array(10);
    const view = new DataView(bytes.buffer);
    bytes[0] = 3;
    bytes[1] = 0;
    writeUint16(view, 2, 0);
    writeUint16(view, 4, 0);
    writeUint16(view, 6, this.snapshot.width);
    writeUint16(view, 8, this.snapshot.height);
    this.send(bytes);
  }

  private send(bytes: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(bytes);
  }

  private process() {
    while (true) {
      if (this.state === 'version') {
        if (this.buffer.length < 12) return;
        const serverVersion = new TextDecoder().decode(this.buffer.slice(0, 12));
        this.protocolVersion = serverVersion.includes('003.003') ? '3.3' : '3.8';
        this.buffer = this.buffer.slice(12);
        this.send(new TextEncoder().encode(`RFB 003.00${this.protocolVersion === '3.3' ? '3' : '8'}\n`));
        this.state = 'security';
      } else if (this.state === 'security') {
        if (this.protocolVersion === '3.3') {
          if (this.buffer.length < 4) return;
          const type = readUint32(this.buffer, 0);
          this.buffer = this.buffer.slice(4);
          if (type !== 1) {
            this.fail('This bridge requires an unsupported RFB security type.');
            return;
          }
          this.state = 'server-init';
          this.send(new Uint8Array([1]));
          continue;
        }
        if (this.buffer.length < 1) return;
        const count = this.buffer[0];
        if (this.buffer.length < count + 1) return;
        const types = this.buffer.slice(1, count + 1);
        this.buffer = this.buffer.slice(count + 1);
        if (!types.includes(1)) {
          this.fail('This bridge requires an unsupported RFB security type.');
          return;
        }
        this.send(new Uint8Array([1]));
        this.state = 'security-result';
      } else if (this.state === 'security-result') {
        if (this.buffer.length < 4) return;
        const result = readUint32(this.buffer, 0);
        this.buffer = this.buffer.slice(4);
        if (result !== 0) {
          this.fail('The VNC server rejected the local session.');
          return;
        }
        this.send(new Uint8Array([1]));
        this.state = 'server-init';
      } else if (this.state === 'server-init') {
        if (this.buffer.length < 24) return;
        const width = readUint16(this.buffer, 0);
        const height = readUint16(this.buffer, 2);
        const nameLength = readUint32(this.buffer, 20);
        if (this.buffer.length < 24 + nameLength) return;
        this.buffer = this.buffer.slice(24 + nameLength);
        this.update({
          phase: 'connected',
          width,
          height,
          message: 'XFCE desktop connected',
        });
        if (this.canvas) {
          this.canvas.width = width;
          this.canvas.height = height;
        }
        this.sendPixelFormat();
        this.sendEncodings();
        this.state = 'updates';
        this.requestFullFrame();
      } else if (this.state === 'updates') {
        if (this.buffer.length < 4) return;
        const type = this.buffer[0];
        if (type !== 0) {
          this.fail(`Unsupported RFB message type ${type}.`);
          return;
        }
        const count = readUint16(this.buffer, 2);
        let offset = 4;
        for (let i = 0; i < count; i += 1) {
          if (this.buffer.length < offset + 12) return;
          const x = readUint16(this.buffer, offset);
          const y = readUint16(this.buffer, offset + 2);
          const width = readUint16(this.buffer, offset + 4);
          const height = readUint16(this.buffer, offset + 6);
          const encoding = readUint32(this.buffer, offset + 8);
          if (encoding !== 0) {
            this.fail(`Unsupported framebuffer encoding ${encoding}.`);
            return;
          }
          const byteLength = width * height * 2;
          if (this.buffer.length < offset + 12 + byteLength) return;
          this.drawRaw(
            x,
            y,
            width,
            height,
            this.buffer.slice(offset + 12, offset + 12 + byteLength),
          );
          offset += 12 + byteLength;
        }
        this.buffer = this.buffer.slice(offset);
        this.update({ lastFrameAt: Date.now() });
        this.requestIncrementalFrame();
      }
    }
  }

  private sendPixelFormat() {
    const bytes = new Uint8Array(20);
    const view = new DataView(bytes.buffer);
    bytes[0] = 0;
    bytes[4] = 16;
    bytes[5] = 16;
    bytes[7] = 1;
    writeUint16(view, 8, 31);
    writeUint16(view, 10, 63);
    writeUint16(view, 12, 31);
    bytes[14] = 11;
    bytes[15] = 5;
    bytes[16] = 0;
    this.send(bytes);
  }

  private sendEncodings() {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    bytes[0] = 2;
    writeUint16(view, 2, 1);
    writeUint32(view, 4, 0);
    this.send(bytes);
  }

  private requestIncrementalFrame() {
    const bytes = new Uint8Array(10);
    const view = new DataView(bytes.buffer);
    bytes[0] = 3;
    bytes[1] = 1;
    writeUint16(view, 6, this.snapshot.width);
    writeUint16(view, 8, this.snapshot.height);
    this.send(bytes);
  }

  private drawRaw(x: number, y: number, width: number, height: number, pixels: Uint8Array) {
    if (!this.context) return;
    const image = this.context.createImageData(width, height);
    for (let i = 0; i < width * height; i += 1) {
      const source = i * 2;
      const pixel = (pixels[source] << 8) | pixels[source + 1];
      const target = i * 4;
      image.data[target] = ((pixel >> 11) & 0x1f) * 255 / 31;
      image.data[target + 1] = ((pixel >> 5) & 0x3f) * 255 / 63;
      image.data[target + 2] = (pixel & 0x1f) * 255 / 31;
      image.data[target + 3] = 255;
    }
    this.context.putImageData(image, x, y);
  }

  private fail(message: string) {
    this.socket?.close();
    this.update({ phase: 'error', message });
  }

  private update(next: Partial<VncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    this.phase = this.snapshot.phase;
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

export function localVncUrl() {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${base}vnc`;
}