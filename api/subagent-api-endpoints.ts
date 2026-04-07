declare const require: (id: string) => any;

const fs = require("node:fs");
const path = require("node:path");

type HttpResponseLike = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

type HttpRequestLike = {
  url?: string;
  method?: string;
};

type ViteDevServerLike = {
  middlewares: {
    use: (path: string, handler: (req: HttpRequestLike, res: HttpResponseLike) => void) => void;
  };
};

/**
 * Subagent API endpoint catalog + middleware for OpenClaw Gateway.
 *
 * Assumptions from deployment:
 * - Repo checkout: /opt/openclaw/moltbot
 * - State dir: /root/.openclaw
 * - Gateway port: 18789 (default)
 *
 * Important: there is no dedicated public JSON-RPC method named "sessions.spawn".
 * Subagent spawning is performed via the sessions_spawn tool during an agent/chat run.
 */

export const GATEWAY_HOST = "127.0.0.1";
export const GATEWAY_PORT = 18789;

export const GATEWAY_HTTP_BASE = `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;
export const GATEWAY_WS_BASE = `ws://${GATEWAY_HOST}:${GATEWAY_PORT}`;

/** JSON-RPC WebSocket endpoint used by the dashboard/client. */
export const GATEWAY_RPC_WS_ENDPOINT = `${GATEWAY_WS_BASE}/ws`;

export const SUBAGENT_STORAGE = {
  stateDir: "/root/.openclaw",
  subagentRunsFile: "/root/.openclaw/subagents/runs.json",
  taskLedgerSqlite: "/root/.openclaw/tasks/runs.sqlite",
  sessionsDir: "/root/.openclaw/agents",
};

export const SUBAGENT_RPC_METHODS = {
  listSessions: "sessions.list",
  previewSession: "sessions.preview",
  chatHistory: "chat.history",
  send: "sessions.send",
  steer: "sessions.steer",
  abort: "sessions.abort",
  patch: "sessions.patch",
  reset: "sessions.reset",
  deleteSession: "sessions.delete",
  runAgent: "agent",
  runChat: "chat.send",
} as const;

export type SubagentRpcMethod =
  (typeof SUBAGENT_RPC_METHODS)[keyof typeof SUBAGENT_RPC_METHODS];

/** Tool names relevant to subagent creation/management during an agent run. */
export const SUBAGENT_TOOL_NAMES = {
  spawn: "sessions_spawn",
  list: "subagents",
} as const;

export type JsonRpcRequest<TParams = unknown> = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: TParams;
};

type PersistedSubagentRuns = {
  version?: number;
  runs?: Record<string, unknown>;
};

type SessionsIndexEntry = {
  key: string;
  sessionId?: string;
  label?: string;
  sessionFile?: string;
  [key: string]: unknown;
};

function sendJson(res: HttpResponseLike, body: unknown, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.end(JSON.stringify(body));
}

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function readSubagentRuns() {
  const file = SUBAGENT_STORAGE.subagentRunsFile;
  if (!fs.existsSync(file)) {
    return {
      exists: false,
      file,
      total: 0,
      runs: [] as Array<{ runId: string; entry: unknown }>,
    };
  }

  const parsed = readJsonFile(file) as PersistedSubagentRuns;
  const runsRecord = parsed && typeof parsed.runs === "object" && parsed.runs ? parsed.runs : {};
  const runs = Object.entries(runsRecord).map(([runId, entry]) => ({ runId, entry }));
  runs.sort((a, b) => {
    const aTs = Number((a.entry as { startedAt?: unknown })?.startedAt || 0);
    const bTs = Number((b.entry as { startedAt?: unknown })?.startedAt || 0);
    return bTs - aTs;
  });

  return {
    exists: true,
    file,
    version: parsed.version,
    total: runs.length,
    runs,
  };
}

function listSubagentSessions() {
  const baseDir = SUBAGENT_STORAGE.sessionsDir;
  if (!fs.existsSync(baseDir)) {
    return {
      exists: false,
      baseDir,
      total: 0,
      sessions: [] as SessionsIndexEntry[],
    };
  }

  const sessions: SessionsIndexEntry[] = [];
  const agentIds = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const agentDirEnt of agentIds) {
    if (!agentDirEnt.isDirectory()) {
      continue;
    }
    const sessionsFile = path.join(baseDir, agentDirEnt.name, "sessions", "sessions.json");
    if (!fs.existsSync(sessionsFile)) {
      continue;
    }
    try {
      const parsed = readJsonFile(sessionsFile) as Record<string, SessionsIndexEntry>;
      for (const entry of Object.values(parsed)) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const key = typeof entry.key === "string" ? entry.key : "";
        if (!key.includes(":subagent:")) {
          continue;
        }
        sessions.push(entry);
      }
    } catch {
      // Ignore malformed session stores and continue.
    }
  }

  return {
    exists: true,
    baseDir,
    total: sessions.length,
    sessions,
  };
}

export function buildSubagentRpcRequest<TParams>(
  id: string | number,
  method: SubagentRpcMethod,
  params: TParams,
): JsonRpcRequest<TParams> {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
}

export function subagentMethodList(): SubagentRpcMethod[] {
  return Object.values(SUBAGENT_RPC_METHODS);
}

/**
 * Registers mission-control-style subagent helper endpoints:
 * - /api/subagents/health
 * - /api/subagents/methods
 * - /api/subagents/storage
 * - /api/subagents/runs
 * - /api/subagents/sessions
 */
export function registerSubagentApi(server: ViteDevServerLike) {
  const handler = (req: HttpRequestLike, res: HttpResponseLike) => {
    const requestUrl = req.url || "/";
    const parsed = new URL(requestUrl, "http://localhost");
    const pathname = parsed.pathname;
    const normalized =
      pathname.replace(/^\/apis\/subagents/, "").replace(/^\/api\/subagents/, "") || "/";
    const method = (req.method || "GET").toUpperCase();

    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.end("");
      return;
    }

    try {
      if (normalized === "/health") {
        sendJson(res, {
          ok: true,
          service: "subagents",
          gateway: {
            http: GATEWAY_HTTP_BASE,
            ws: GATEWAY_RPC_WS_ENDPOINT,
          },
        });
        return;
      }

      if (normalized === "/methods") {
        sendJson(res, {
          methods: SUBAGENT_RPC_METHODS,
          tools: SUBAGENT_TOOL_NAMES,
          list: subagentMethodList(),
        });
        return;
      }

      if (normalized === "/storage") {
        sendJson(res, {
          storage: SUBAGENT_STORAGE,
          exists: {
            stateDir: fs.existsSync(SUBAGENT_STORAGE.stateDir),
            runsFile: fs.existsSync(SUBAGENT_STORAGE.subagentRunsFile),
            taskLedgerSqlite: fs.existsSync(SUBAGENT_STORAGE.taskLedgerSqlite),
            sessionsDir: fs.existsSync(SUBAGENT_STORAGE.sessionsDir),
          },
        });
        return;
      }

      if (normalized === "/runs") {
        sendJson(res, readSubagentRuns());
        return;
      }

      if (normalized === "/sessions") {
        sendJson(res, listSubagentSessions());
        return;
      }

      sendJson(res, { error: "Not Found" }, 404);
    } catch (error) {
      sendJson(
        res,
        {
          error: error instanceof Error ? error.message : String(error),
          storage: SUBAGENT_STORAGE,
        },
        500,
      );
    }
  };

  server.middlewares.use("/api/subagents", handler);
  server.middlewares.use("/apis/subagents", handler);
}
