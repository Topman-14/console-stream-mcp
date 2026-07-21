import { startCapture, PROTOCOL_VERSION, type ClientMessage } from "@mobius-mcp/capture-core";

export interface StartMobiusStreamOptions {
  port?: number;
  console?: boolean;
  errors?: boolean;
  network?: boolean;
  navigation?: boolean;
}

export function startMobiusStream(options: StartMobiusStreamOptions = {}): () => void {
  const port = options.port ?? 7331;
  const { console: captureConsole = true, errors = true, network = true, navigation = true } = options;
  const clientId = crypto.randomUUID();
  let ws: WebSocket | null = null;
  let stopped = false;
  let retryDelay = 500;

  const queue: ClientMessage[] = [];

  function send(message: ClientMessage) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      queue.push(message);
    }
  }

  function connect() {
    if (stopped) return;
    ws = new WebSocket(`ws://localhost:${port}`);

    ws.addEventListener("open", () => {
      retryDelay = 500;
      send({
        version: PROTOCOL_VERSION,
        kind: "hello",
        client: {
          clientId,
          clientType: "npm-client",
          pageUrl: window.location.href,
          title: document.title,
          capabilities: [],
          captureSettings: { console: captureConsole, errors, network, navigation, dom: false },
        },
      });
      while (queue.length > 0) {
        const msg = queue.shift()!;
        ws!.send(JSON.stringify(msg));
      }
    });

    ws.addEventListener("close", () => {
      if (stopped) return;
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10_000);
    });

    ws.addEventListener("error", () => ws?.close());
  }

  connect();

  const unpatch = startCapture(
    (event) => {
      send({ version: PROTOCOL_VERSION, kind: "event", clientId, event });
    },
    { console: captureConsole, errors, network, navigation },
  );

  return () => {
    stopped = true;
    unpatch();
    ws?.close();
  };
}
