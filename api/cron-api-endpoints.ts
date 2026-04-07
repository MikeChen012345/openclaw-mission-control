import fs from "node:fs";
import path from "node:path";

type HttpResponseLike = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

type HttpRequestLike = {
  url?: string;
  method?: string;
  on?: (event: string, listener: (chunk?: unknown) => void) => void;
};

type ViteDevServerLike = {
  middlewares: {
    use: (path: string, handler: (req: HttpRequestLike, res: HttpResponseLike) => void) => void;
  };
};

/**
 * Cron API endpoint catalog + middleware for OpenClaw Gateway.
 *
 * Assumptions from deployment:
 * - Repo checkout: /opt/openclaw/moltbot
 * - State dir: /root/.openclaw
 * - Gateway port: 18789 (default)
 */

export const GATEWAY_HOST = "127.0.0.1";
export const GATEWAY_PORT = 18789;

export const GATEWAY_HTTP_BASE = `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;
export const GATEWAY_WS_BASE = `ws://${GATEWAY_HOST}:${GATEWAY_PORT}`;

/** JSON-RPC WebSocket endpoint used by the dashboard/client. */
export const GATEWAY_RPC_WS_ENDPOINT = `${GATEWAY_WS_BASE}/ws`;

export const CRON_STORAGE = {
  stateDir: "/root/.openclaw",
  jobsFile: "/root/.openclaw/cron/jobs.json",
  runsDir: "/root/.openclaw/cron/runs",
};

export const CRON_RPC_METHODS = {
  list: "cron.list",
  status: "cron.status",
  add: "cron.add",
  update: "cron.update",
  remove: "cron.remove",
  run: "cron.run",
  runs: "cron.runs",
  wake: "wake",
} as const;

export type CronRpcMethod = (typeof CRON_RPC_METHODS)[keyof typeof CRON_RPC_METHODS];

export type JsonRpcRequest<TParams = unknown> = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: TParams;
};

type CronRunLogEntry = {
  ts?: number;
  jobId?: string;
  action?: string;
  status?: string;
  error?: string;
  summary?: string;
  sessionKey?: string;
};

type CronJobsStore = {
  version?: number;
  jobs?: unknown[];
};

type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string; staggerMs?: number };

type CronPayload =
  | { kind: "systemEvent"; text: string }
  | { kind: "agentTurn"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSchedule(job: Record<string, unknown>): CronSchedule | unknown {
  if (isRecord(job.schedule)) {
    const kind = typeof job.schedule.kind === "string" ? job.schedule.kind : "every";
    if (kind === "at") {
      return { kind: "at", at: typeof job.schedule.at === "string" ? job.schedule.at : "" };
    }
    if (kind === "cron") {
      return {
        kind: "cron",
        expr: typeof job.schedule.expr === "string" ? job.schedule.expr : "",
        tz: typeof job.schedule.tz === "string" ? job.schedule.tz : undefined,
        staggerMs: typeof job.schedule.staggerMs === "number" ? job.schedule.staggerMs : undefined,
      };
    }
    return {
      kind: "every",
      everyMs: toNumber(job.schedule.everyMs, 5 * 60_000),
      anchorMs: typeof job.schedule.anchorMs === "number" ? job.schedule.anchorMs : undefined,
    };
  }

  if (typeof job.schedule === "string" && job.schedule.trim()) {
    return {
      kind: "cron",
      expr: job.schedule.trim(),
    };
  }

  if (typeof job.scheduleType === "string") {
    if (job.scheduleType === "at") {
      return { kind: "at", at: typeof job.scheduleValue === "string" ? job.scheduleValue : "" };
    }
    if (job.scheduleType === "cron") {
      return { kind: "cron", expr: typeof job.scheduleValue === "string" ? job.scheduleValue : "" };
    }
    return {
      kind: "every",
      everyMs: toNumber(job.scheduleValue, 5) * 60_000,
    };
  }

  return {
    kind: "every",
    everyMs: 5 * 60_000,
  };
}

function normalizePayload(job: Record<string, unknown>): CronPayload {
  if (isRecord(job.payload)) {
    const kind = typeof job.payload.kind === "string" ? job.payload.kind : "systemEvent";
    if (kind === "agentTurn") {
      return {
        kind: "agentTurn",
        message: typeof job.payload.message === "string" ? job.payload.message : typeof job.payload.text === "string" ? job.payload.text : "",
      };
    }
    return {
      kind: "systemEvent",
      text: typeof job.payload.text === "string" ? job.payload.text : typeof job.payload.message === "string" ? job.payload.message : "",
    };
  }

  if (typeof job.prompt === "string" && job.prompt.trim()) {
    return {
      kind: "agentTurn",
      message: job.prompt.trim(),
    };
  }

  return {
    kind: "systemEvent",
    text: typeof job.systemText === "string" ? job.systemText : "",
  };
}

function normalizeCronJob(job: unknown) {
  if (!isRecord(job)) return job;

  const nextRunAtMs = isRecord(job.state) ? job.state.nextRunAtMs : undefined;
  const normalizedState = isRecord(job.state)
    ? {
        ...job.state,
        nextRunAtMs: typeof nextRunAtMs === "number" ? nextRunAtMs : Number(nextRunAtMs),
      }
    : undefined;

  const normalized: Record<string, unknown> = {
    ...job,
    schedule: normalizeSchedule(job),
    sessionTarget: typeof job.sessionTarget === "string"
      ? job.sessionTarget
      : typeof job.session === "string"
        ? job.session
        : typeof job.sessionKey === "string"
          ? job.sessionKey
          : "main",
    wakeMode: typeof job.wakeMode === "string" ? job.wakeMode : "now",
    payload: normalizePayload(job),
  };

  delete normalized.scheduleType;
  delete normalized.scheduleValue;
  delete normalized.scheduleUnit;
  delete normalized.session;
  delete normalized.prompt;
  delete normalized.systemText;

  if (normalizedState) {
    normalized.state = normalizedState;
  }

  if (typeof normalized.createdAtMs !== "number" && typeof normalized.updatedAtMs !== "number") {
    const now = Date.now();
    normalized.createdAtMs = now;
    normalized.updatedAtMs = now;
  } else if (typeof normalized.updatedAtMs !== "number") {
    normalized.updatedAtMs = typeof normalized.createdAtMs === "number" ? normalized.createdAtMs : Date.now();
  }

  return normalized;
}

function normalizeCronJobsStore(store: Required<CronJobsStore>) {
  return {
    ...store,
    jobs: store.jobs.map((job) => normalizeCronJob(job)),
  };
}

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

function ensureCronStorage() {
  const jobsDir = path.dirname(CRON_STORAGE.jobsFile);
  if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir, { recursive: true });
  }
  if (!fs.existsSync(CRON_STORAGE.runsDir)) {
    fs.mkdirSync(CRON_STORAGE.runsDir, { recursive: true });
  }
  if (!fs.existsSync(CRON_STORAGE.jobsFile)) {
    fs.writeFileSync(CRON_STORAGE.jobsFile, JSON.stringify({ version: 1, jobs: [] }, null, 2), "utf8");
  }
}

function readCronJobsStore(): Required<CronJobsStore> {
  ensureCronStorage();
  const parsed = readJsonFile(CRON_STORAGE.jobsFile) as CronJobsStore;
  const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  const version = Number.isFinite(Number(parsed?.version)) ? Number(parsed?.version) : 1;
  return normalizeCronJobsStore({ version, jobs });
}

function writeCronJobsStore(store: Required<CronJobsStore>) {
  ensureCronStorage();
  fs.writeFileSync(
    CRON_STORAGE.jobsFile,
    JSON.stringify(normalizeCronJobsStore(store), null, 2),
    "utf8",
  );
}

function appendCronRunLog(entry: CronRunLogEntry) {
  ensureCronStorage();
  const jobId = (entry.jobId || "unknown").trim() || "unknown";
  const logPath = path.join(CRON_STORAGE.runsDir, `${jobId}.jsonl`);
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function readRequestBody(req: HttpRequestLike): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!req.on) {
      resolve({});
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk as Buffer));
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", (error) => reject(error as Error));
  });
}

function getJobId(job: unknown) {
  if (!job || typeof job !== "object") return "";
  const maybeId = (job as { id?: unknown }).id;
  return typeof maybeId === "string" ? maybeId.trim() : "";
}

function listCronJobs() {
  if (!fs.existsSync(CRON_STORAGE.jobsFile)) {
    return {
      exists: false,
      file: CRON_STORAGE.jobsFile,
      jobs: [] as unknown[],
    };
  }
  const parsed = readJsonFile(CRON_STORAGE.jobsFile) as { jobs?: unknown[]; version?: unknown };
  const jobs = Array.isArray(parsed.jobs) ? parsed.jobs.map((job) => normalizeCronJob(job)) : [];
  return {
    exists: true,
    file: CRON_STORAGE.jobsFile,
    version: parsed.version,
    total: jobs.length,
    jobs,
  };
}

function parseRunLogFile(filePath: string, limit: number): CronRunLogEntry[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean);
  const out: CronRunLogEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const parsed = JSON.parse(lines[i] as string) as CronRunLogEntry;
      out.push(parsed);
    } catch {
      // Ignore malformed lines.
    }
  }
  return out;
}

function listCronRuns(jobId: string | null, limit: number) {
  const runsDir = CRON_STORAGE.runsDir;
  if (!fs.existsSync(runsDir)) {
    return {
      exists: false,
      dir: runsDir,
      totalFiles: 0,
      runs: [] as CronRunLogEntry[],
    };
  }

  const fileNames = fs
    .readdirSync(runsDir)
    .filter((name: string) => name.endsWith(".jsonl"))
    .filter((name: string) => (jobId ? name === `${jobId}.jsonl` : true));

  const runs: CronRunLogEntry[] = [];
  for (const name of fileNames) {
    const filePath = path.join(runsDir, name);
    const entries = parseRunLogFile(filePath, limit);
    runs.push(...entries);
  }

  runs.sort((a, b) => (Number(b.ts ?? 0) || 0) - (Number(a.ts ?? 0) || 0));

  return {
    exists: true,
    dir: runsDir,
    totalFiles: fileNames.length,
    runs: runs.slice(0, limit),
  };
}

export function buildCronRpcRequest<TParams>(
  id: string | number,
  method: CronRpcMethod,
  params: TParams,
): JsonRpcRequest<TParams> {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
}

export function cronMethodList(): CronRpcMethod[] {
  return Object.values(CRON_RPC_METHODS);
}

/**
 * Registers mission-control-style cron helper endpoints:
 * - /api/cron/health
 * - /api/cron/methods
 * - /api/cron/storage
 * - /api/cron/jobs
 * - /api/cron/runs?jobId=<id>&limit=200
 */
export function registerCronApi(server: ViteDevServerLike) {
  const handler = async (req: HttpRequestLike, res: HttpResponseLike) => {
    const requestUrl = req.url || "/";
    const parsed = new URL(requestUrl, "http://localhost");
    const pathname = parsed.pathname;
    const normalized = pathname.replace(/^\/apis\/cron/, "").replace(/^\/api\/cron/, "") || "/";
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
          service: "cron",
          gateway: {
            http: GATEWAY_HTTP_BASE,
            ws: GATEWAY_RPC_WS_ENDPOINT,
          },
        });
        return;
      }

      if (normalized === "/methods") {
        sendJson(res, {
          methods: CRON_RPC_METHODS,
          list: cronMethodList(),
        });
        return;
      }

      if (normalized === "/storage") {
        sendJson(res, {
          storage: CRON_STORAGE,
          exists: {
            stateDir: fs.existsSync(CRON_STORAGE.stateDir),
            jobsFile: fs.existsSync(CRON_STORAGE.jobsFile),
            runsDir: fs.existsSync(CRON_STORAGE.runsDir),
          },
        });
        return;
      }

      if (normalized === "/jobs") {
        if (method === "GET") {
          sendJson(res, listCronJobs());
          return;
        }

        if (method === "POST") {
          const body = await readRequestBody(req);
          const candidate = (body && typeof body === "object" && "job" in (body as Record<string, unknown>))
            ? (body as { job?: unknown }).job
            : body;

          if (!candidate || typeof candidate !== "object") {
            sendJson(res, { error: "Invalid cron job payload" }, 400);
            return;
          }

          const id = getJobId(candidate);
          if (!id) {
            sendJson(res, { error: "Cron job must include non-empty id" }, 400);
            return;
          }

          const normalizedCandidate = normalizeCronJob(candidate);

          const store = readCronJobsStore();
          const exists = store.jobs.some((job) => getJobId(job) === id);
          if (exists) {
            sendJson(res, { error: `Cron job '${id}' already exists` }, 409);
            return;
          }

          store.jobs.push(normalizedCandidate);
          writeCronJobsStore(store);
          sendJson(res, { ok: true, action: "created", id, total: store.jobs.length });
          return;
        }

        sendJson(res, { error: "Method Not Allowed" }, 405);
        return;
      }

      if (normalized.startsWith("/jobs/")) {
        const jobId = decodeURIComponent(normalized.slice("/jobs/".length)).trim();
        if (!jobId) {
          sendJson(res, { error: "Missing job id" }, 400);
          return;
        }

        if (method === "DELETE") {
          const store = readCronJobsStore();
          const nextJobs = store.jobs.filter((job) => getJobId(job) !== jobId);
          if (nextJobs.length === store.jobs.length) {
            sendJson(res, { error: `Cron job '${jobId}' not found` }, 404);
            return;
          }
          writeCronJobsStore({ ...store, jobs: nextJobs });
          sendJson(res, { ok: true, action: "deleted", id: jobId, total: nextJobs.length });
          return;
        }

        if (method === "PUT" || method === "PATCH") {
          const body = await readRequestBody(req);
          const patch = (body && typeof body === "object" && "patch" in (body as Record<string, unknown>))
            ? (body as { patch?: unknown }).patch
            : body;

          if (!patch || typeof patch !== "object") {
            sendJson(res, { error: "Invalid patch payload" }, 400);
            return;
          }

          const store = readCronJobsStore();
          const index = store.jobs.findIndex((job) => getJobId(job) === jobId);
          if (index < 0) {
            sendJson(res, { error: `Cron job '${jobId}' not found` }, 404);
            return;
          }

          const current = (store.jobs[index] && typeof store.jobs[index] === "object") ? store.jobs[index] as Record<string, unknown> : {};
          const next = normalizeCronJob({ ...current, ...(patch as Record<string, unknown>), id: jobId });
          store.jobs[index] = next;
          writeCronJobsStore(store);
          sendJson(res, { ok: true, action: "updated", id: jobId, job: next });
          return;
        }

        sendJson(res, { error: "Method Not Allowed" }, 405);
        return;
      }

      if (normalized === "/run") {
        if (method !== "POST") {
          sendJson(res, { error: "Method Not Allowed" }, 405);
          return;
        }
        const body = await readRequestBody(req) as { id?: unknown; mode?: unknown };
        const id = typeof body?.id === "string" ? body.id.trim() : "";
        if (!id) {
          sendJson(res, { error: "Missing cron job id" }, 400);
          return;
        }
        appendCronRunLog({
          ts: Date.now(),
          jobId: id,
          action: "manual-run",
          status: "queued",
          summary: typeof body?.mode === "string" ? `run requested (${body.mode})` : "run requested",
        });
        sendJson(res, { ok: true, action: "run-requested", id });
        return;
      }

      if (normalized === "/wake") {
        if (method !== "POST") {
          sendJson(res, { error: "Method Not Allowed" }, 405);
          return;
        }
        appendCronRunLog({
          ts: Date.now(),
          jobId: "wake",
          action: "wake",
          status: "queued",
          summary: "wake requested",
        });
        sendJson(res, { ok: true, action: "wake-requested" });
        return;
      }

      if (normalized === "/jobs") {
        sendJson(res, listCronJobs());
        return;
      }

      if (normalized === "/runs") {
        const requestedJobId = (parsed.searchParams.get("jobId") || "").trim();
        const requestedLimitRaw = Number.parseInt(parsed.searchParams.get("limit") || "200", 10);
        const limit = Number.isFinite(requestedLimitRaw)
          ? Math.max(1, Math.min(5000, requestedLimitRaw))
          : 200;
        sendJson(res, listCronRuns(requestedJobId || null, limit));
        return;
      }

      sendJson(res, { error: "Not Found" }, 404);
    } catch (error) {
      sendJson(
        res,
        {
          error: error instanceof Error ? error.message : String(error),
          storage: CRON_STORAGE,
        },
        500,
      );
    }
  };

  server.middlewares.use("/api/cron", handler);
  server.middlewares.use("/apis/cron", handler);
}
