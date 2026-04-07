#!/usr/bin/env node

// This script seeds the SQLite database with sample data for testing and development purposes. It creates the necessary tables if they don't exist and inserts a set of sample tasks, events, and documents that represent typical interactions with Mission Control. 
// Run this script with `npm run seed-database` to populate the database, and then start the logs dashboard to view the seeded data.

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

const OPENCLAW_HOME = "/root/.openclaw";
const DB_PATH = process.env.MISSION_CONTROL_DB_PATH || 
  process.env.SQLITE_DB_PATH || 
  path.join(OPENCLAW_HOME, "mission-control", "events.db");

const CRON_DIR = path.join(OPENCLAW_HOME, "cron");
const CRON_JOBS_FILE = path.join(CRON_DIR, "jobs.json");
const CRON_RUNS_DIR = path.join(CRON_DIR, "runs");

const SUBAGENT_DIR = path.join(OPENCLAW_HOME, "subagents");
const SUBAGENT_RUNS_FILE = path.join(SUBAGENT_DIR, "runs.json");

const AGENTS_DIR = path.join(OPENCLAW_HOME, "agents");
const SUBAGENT_SESSIONS_FILE_MAIN = path.join(AGENTS_DIR, "main", "sessions", "sessions.json");
const SUBAGENT_SESSIONS_FILE_RESEARCH = path.join(AGENTS_DIR, "research", "sessions", "sessions.json");

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`Seeding database at: ${DB_PATH}`);

const db = new Database(DB_PATH);

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    runId TEXT NOT NULL,
    sessionKey TEXT NOT NULL,
    sessionId TEXT,
    agentId TEXT,
    status TEXT NOT NULL CHECK (status IN ('start', 'end', 'error')),
    title TEXT,
    description TEXT,
    prompt TEXT,
    response TEXT,
    error TEXT,
    source TEXT,
    timestamp DATETIME NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    runId TEXT NOT NULL,
    sessionKey TEXT NOT NULL,
    sessionId TEXT,
    eventType TEXT NOT NULL,
    action TEXT NOT NULL,
    title TEXT,
    description TEXT,
    message TEXT,
    data JSON,
    timestamp DATETIME NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    runId TEXT NOT NULL,
    sessionKey TEXT NOT NULL,
    sessionId TEXT,
    agentId TEXT,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT,
    type TEXT NOT NULL,
    path TEXT,
    eventType TEXT,
    timestamp DATETIME NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_sessionKey ON tasks(sessionKey);
  CREATE INDEX IF NOT EXISTS idx_tasks_sessionId ON tasks(sessionId);
  CREATE INDEX IF NOT EXISTS idx_tasks_runId ON tasks(runId);
  CREATE INDEX IF NOT EXISTS idx_events_runId ON events(runId);
  CREATE INDEX IF NOT EXISTS idx_events_sessionId ON events(sessionId);
  CREATE INDEX IF NOT EXISTS idx_documents_runId ON documents(runId);
  CREATE INDEX IF NOT EXISTS idx_documents_sessionId ON documents(sessionId);
`);

// Ensure sessionId exists for older databases
function ensureColumnExists(tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`);
  }
}

ensureColumnExists("tasks", "sessionId", "sessionId TEXT");
ensureColumnExists("events", "sessionId", "sessionId TEXT");
ensureColumnExists("documents", "sessionId", "sessionId TEXT");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

// Sample test data
const now = new Date().toISOString();

const sampleTasks = [
  {
    runId: "run-2024-12-15-001",
    sessionKey: "session-001",
    sessionId: "sess-001",
    agentId: "agent-research",
    status: "end",
    title: "Research Market Analysis",
    description: "Conducted comprehensive market analysis for Q4 2024 strategic planning",
    prompt: "Analyze the current market trends in cloud computing and provide key insights for enterprise adoption",
    response: JSON.stringify({ "market_size": "$500B", "growth_rate": "18%", "key_players": ["AWS", "Azure", "GCP"] }),
    source: "openclaw-agent",
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-002",
    sessionKey: "session-001",
    sessionId: "sess-001",
    agentId: "agent-planning",
    status: "end",
    title: "Create Strategic Roadmap",
    description: "Generated 12-month strategic roadmap based on market analysis",
    prompt: "Create a 12-month technology roadmap prioritizing cloud migration and AI integration",
    response: JSON.stringify({ "phases": 3, "timeline": "12 months", "estimated_cost": "$2.5M" }),
    source: "openclaw-agent",
    timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-003",
    sessionKey: "session-002",
    sessionId: "sess-002",
    agentId: "agent-code-review",
    status: "error",
    title: "Code Quality Assessment Failed",
    description: "Error encountered during codebase analysis - timeout on large file",
    prompt: "Review the Java codebase for architectural issues and suggest refactoring priorities",
    error: "Timeout: File analysis exceeded 30 second limit on /src/core/Engine.java",
    source: "openclaw-agent",
    timestamp: new Date(Date.now() - 3 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-004",
    sessionKey: "session-002",
    sessionId: "sess-002",
    agentId: "agent-testing",
    status: "end",
    title: "Test Coverage Analysis",
    description: "Analyzed test coverage and identified gaps in critical paths",
    prompt: "Analyze test coverage and identify areas that need additional test cases",
    response: JSON.stringify({ "coverage": "73%", "gaps": ["error-handling", "concurrency"], "recommendation": "priority-1" }),
    source: "openclaw-agent",
    timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-005",
    sessionKey: "session-003",
    sessionId: "sess-003",
    agentId: "agent-security",
    status: "start",
    title: null,
    description: null,
    prompt: "Perform security audit on API endpoints and identify vulnerabilities",
    response: null,
    source: "openclaw-agent",
    timestamp: new Date(Date.now() - 1 * 60 * 1000).toISOString()
  }
];

const sampleEvents = [
  {
    runId: "run-2024-12-15-001",
    sessionKey: "session-001",
    sessionId: "sess-001",
    eventType: "tool:start",
    action: "search",
    title: "Starting Market Search",
    description: "Initializing search for market analysis data",
    message: "Beginning search for cloud market trends",
    data: JSON.stringify({ tool: "search", args: { query: "cloud market trends 2024" } }),
    timestamp: new Date(Date.now() - 4.5 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-001",
    sessionKey: "session-001",
    sessionId: "sess-001",
    eventType: "tool:result",
    action: "search",
    title: "Market Search Complete",
    description: "Successfully retrieved 45 relevant sources",
    message: "Found 45 relevant sources for market analysis",
    data: JSON.stringify({ tool: "search", result: { sources: 45, articles: 32, reports: 13 } }),
    timestamp: new Date(Date.now() - 4.2 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-001",
    sessionKey: "session-001",
    sessionId: "sess-001",
    eventType: "agent:progress",
    action: "analyzing",
    title: "Synthesizing Insights",
    description: "Combining data from multiple sources into coherent analysis",
    message: "Synthesizing insights from market data",
    data: JSON.stringify({ phase: "analysis", progress: 75 }),
    timestamp: new Date(Date.now() - 3.8 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-002",
    sessionKey: "session-001",
    sessionId: "sess-001",
    eventType: "tool:start",
    action: "document",
    title: "Creating Roadmap Document",
    description: "Generating structured roadmap document",
    message: "Starting roadmap document generation",
    data: JSON.stringify({ tool: "document", args: { format: "markdown", type: "roadmap" } }),
    timestamp: new Date(Date.now() - 3.5 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-003",
    sessionKey: "session-002",
    sessionId: "sess-002",
    eventType: "tool:start",
    action: "analyze",
    title: "Starting Code Analysis",
    description: "Beginning codebase analysis process",
    message: "Analyzing Java codebase for issues",
    data: JSON.stringify({ tool: "analyze", args: { language: "java", depth: "full" } }),
    timestamp: new Date(Date.now() - 2.5 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-003",
    sessionKey: "session-002",
    sessionId: "sess-002",
    eventType: "agent:error",
    action: "timeout",
    title: "Analysis Timeout",
    description: "Large file exceeded timeout threshold",
    message: "Timeout during Engine.java analysis",
    data: JSON.stringify({ error: "timeout", file: "/src/core/Engine.java", duration_ms: 30000 }),
    timestamp: new Date(Date.now() - 2.2 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-004",
    sessionKey: "session-002",
    sessionId: "sess-002",
    eventType: "tool:start",
    action: "test_analyze",
    title: "Analyzing Test Coverage",
    description: "Scanning test files and coverage metrics",
    message: "Running test coverage analysis",
    data: JSON.stringify({ tool: "test_analyze", args: { framework: "junit", threshold: 70 } }),
    timestamp: new Date(Date.now() - 1.5 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-004",
    sessionKey: "session-002",
    sessionId: "sess-002",
    eventType: "tool:result",
    action: "test_analyze",
    title: "Coverage Report Ready",
    description: "Test coverage analysis completed with detailed metrics",
    message: "Coverage analysis complete: 73% overall",
    data: JSON.stringify({ tool: "test_analyze", result: { coverage: 73, files: 145, gaps: 12 } }),
    timestamp: new Date(Date.now() - 1.2 * 60 * 1000).toISOString()
  }
];

const sampleDocuments = [
  {
    runId: "run-2024-12-15-001",
    sessionKey: "session-001",
    sessionId: "sess-001",
    agentId: "agent-research",
    title: "Market Analysis Report Q4 2024",
    description: "Comprehensive market analysis covering cloud computing trends and enterprise adoption metrics",
    content: "# Market Analysis Report\n\n## Executive Summary\nThe cloud computing market is experiencing strong growth at 18% YoY. Major trends include multi-cloud adoption, serverless computing, and AI integration.\n\n## Market Size\n- Current: $500B\n- Projected 2025: $590B\n- CAGR: 18%\n\n## Key Players\n1. AWS - 32% market share\n2. Azure - 23% market share\n3. GCP - 11% market share\n\n## Strategic Recommendations\n- Invest in multi-cloud strategy\n- Accelerate AI/ML adoption\n- Focus on security and compliance",
    type: "markdown",
    path: "reports/market-analysis-q4-2024.md",
    eventType: "document:created",
    timestamp: new Date(Date.now() - 4.0 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-002",
    sessionKey: "session-001",
    sessionId: "sess-001",
    agentId: "agent-planning",
    title: "12-Month Strategic Roadmap",
    description: "Detailed technology roadmap with phases, timelines, and resource allocation",
    content: "# Technology Roadmap 2024-2025\n\n## Phase 1: Foundation (Jan-Apr)\n- Assess current infrastructure\n- Plan cloud migration strategy\n- Budget: $500K\n\n## Phase 2: Migration (May-Aug)\n- Migrate critical systems to cloud\n- Implement monitoring and security\n- Budget: $1.2M\n\n## Phase 3: Optimization (Sep-Dec)\n- Optimize cloud spending\n- Implement AI/ML capabilities\n- Budget: $800K\n\nTotal Estimated Cost: $2.5M\nSuccsess Metric: 80% of workloads migrated to cloud",
    type: "markdown",
    path: "roadmaps/tech-roadmap-2024-2025.md",
    eventType: "document:created",
    timestamp: new Date(Date.now() - 3.5 * 60 * 1000).toISOString()
  },
  {
    runId: "run-2024-12-15-004",
    sessionKey: "session-002",
    sessionId: "sess-002",
    agentId: "agent-testing",
    title: "Test Coverage Gap Analysis",
    description: "Detailed analysis of test coverage gaps and recommendations for improvement",
    content: "# Test Coverage Analysis\n\n## Overall Coverage: 73%\n\n## By Module\n- Core Engine: 85%\n- API Layer: 68%\n- Data Access: 79%\n- Utilities: 55%\n\n## Critical Gaps\n1. Error handling in connection pooling (0% coverage)\n2. Concurrent request handling (15% coverage)\n3. Database transaction rollback (22% coverage)\n\n## Recommended Actions\n- Add 12 new test cases for error handling\n- Create concurrency test suite (8 tests)\n- Implement integration tests for transactions\n\nEstimated Effort: 40 hours\nExpected Coverage Improvement: 73% → 85%",
    type: "markdown",
    path: "reports/test-coverage-analysis.md",
    eventType: "document:created",
    timestamp: new Date(Date.now() - 1.0 * 60 * 1000).toISOString()
  }
];

const sampleCronJobs = [
  {
    id: "cron-daily-market-brief",
    name: "Daily Market Brief",
    schedule: "0 9 * * 1-5",
    timezone: "UTC",
    enabled: true,
    wakeMode: "now",
    sessionKey: "session-001",
    prompt: "Summarize market activity and top risks for today.",
  },
  {
    id: "cron-security-weekly",
    name: "Weekly Security Sweep",
    schedule: "0 2 * * 1",
    timezone: "UTC",
    enabled: true,
    wakeMode: "now",
    sessionKey: "session-002",
    prompt: "Run weekly dependency and policy checks; report critical findings.",
  },
  {
    id: "cron-test-coverage-report",
    name: "Coverage Report",
    schedule: "*/30 * * * *",
    timezone: "UTC",
    enabled: false,
    wakeMode: "now",
    sessionKey: "session-002",
    prompt: "Collect latest test coverage and post trend summary.",
  },
];

const sampleCronRuns = {
  "cron-daily-market-brief": [
    {
      ts: Date.now() - 60 * 60 * 1000,
      jobId: "cron-daily-market-brief",
      action: "run",
      status: "ok",
      summary: "Published brief with 3 key market signals.",
      sessionKey: "session-001",
    },
    {
      ts: Date.now() - 25 * 60 * 60 * 1000,
      jobId: "cron-daily-market-brief",
      action: "run",
      status: "ok",
      summary: "Published brief with low volatility alert.",
      sessionKey: "session-001",
    },
  ],
  "cron-security-weekly": [
    {
      ts: Date.now() - 3 * 60 * 60 * 1000,
      jobId: "cron-security-weekly",
      action: "run",
      status: "error",
      error: "Dependency scan timed out for module core-api.",
      summary: "Partial scan completed before timeout.",
      sessionKey: "session-002",
    },
  ],
};

const sampleSubagentRuns = {
  version: 1,
  runs: {
    "sub-run-001": {
      runId: "sub-run-001",
      parentRunId: "run-2024-12-15-001",
      sessionKey: "session-001:subagent:market-scout",
      parentSessionKey: "session-001",
      sessionId: "sess-001",
      agentId: "market-scout",
      startedAt: Date.now() - 4 * 60 * 1000,
      status: "completed",
      summary: "Gathered competitor pricing snapshots.",
    },
    "sub-run-002": {
      runId: "sub-run-002",
      parentRunId: "run-2024-12-15-004",
      sessionKey: "session-002:subagent:test-gap-finder",
      parentSessionKey: "session-002",
      sessionId: "sess-002",
      agentId: "test-gap-finder",
      startedAt: Date.now() - 90 * 1000,
      status: "completed",
      summary: "Identified 12 missing concurrency test cases.",
    },
  },
};

const sampleSubagentSessionsMain = {
  "main:subagent:market-scout": {
    key: "main:subagent:market-scout",
    sessionId: "sess-001",
    label: "Market Scout Subagent",
    sessionFile: "/root/.openclaw/agents/main/sessions/main-subagent-market-scout.json",
  },
  "main:subagent:test-gap-finder": {
    key: "main:subagent:test-gap-finder",
    sessionId: "sess-002",
    label: "Test Gap Finder",
    sessionFile: "/root/.openclaw/agents/main/sessions/main-subagent-test-gap-finder.json",
  },
};

const sampleSubagentSessionsResearch = {
  "research:subagent:risk-watcher": {
    key: "research:subagent:risk-watcher",
    sessionId: "sess-003",
    label: "Risk Watcher",
    sessionFile: "/root/.openclaw/agents/research/sessions/research-subagent-risk-watcher.json",
  },
};

try {
  // Insert tasks
  console.log("\n📝 Inserting sample tasks...");
  const insertTask = db.prepare(`
    INSERT INTO tasks (runId, sessionKey, sessionId, agentId, status, title, description, prompt, response, error, source, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  sampleTasks.forEach((task) => {
    insertTask.run(
      task.runId,
      task.sessionKey,
      task.sessionId || null,
      task.agentId || null,
      task.status,
      task.title || null,
      task.description || null,
      task.prompt || null,
      task.response || null,
      task.error || null,
      task.source,
      task.timestamp
    );
    console.log(`  ✓ ${task.runId} (${task.status})`);
  });

  // Insert events
  console.log("\n📋 Inserting sample events...");
  const insertEvent = db.prepare(`
    INSERT INTO events (runId, sessionKey, sessionId, eventType, action, title, description, message, data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  sampleEvents.forEach((event) => {
    insertEvent.run(
      event.runId,
      event.sessionKey,
      event.sessionId || null,
      event.eventType,
      event.action,
      event.title || null,
      event.description || null,
      event.message || null,
      event.data || null,
      event.timestamp
    );
    console.log(`  ✓ ${event.runId} - ${event.eventType}`);
  });

  // Insert documents
  console.log("\n📄 Inserting sample documents...");
  const insertDoc = db.prepare(`
    INSERT INTO documents (runId, sessionKey, sessionId, agentId, title, description, content, type, path, eventType, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  sampleDocuments.forEach((doc) => {
    insertDoc.run(
      doc.runId,
      doc.sessionKey,
      doc.sessionId || null,
      doc.agentId || null,
      doc.title,
      doc.description || null,
      doc.content || null,
      doc.type,
      doc.path || null,
      doc.eventType || null,
      doc.timestamp
    );
    console.log(`  ✓ ${doc.title}`);
  });

  // Show summary
  const taskCount = db.prepare("SELECT COUNT(*) as count FROM tasks").get();
  const eventCount = db.prepare("SELECT COUNT(*) as count FROM events").get();
  const docCount = db.prepare("SELECT COUNT(*) as count FROM documents").get();

  console.log("\n✨ Seeding complete!");
  console.log(`   Tasks: ${taskCount.count}`);
  console.log(`   Events: ${eventCount.count}`);
  console.log(`   Documents: ${docCount.count}`);

  console.log("\n⏰ Writing cron mock data...");
  ensureDir(CRON_RUNS_DIR);
  writeJson(CRON_JOBS_FILE, { version: 1, jobs: sampleCronJobs });
  for (const [jobId, entries] of Object.entries(sampleCronRuns)) {
    const logPath = path.join(CRON_RUNS_DIR, `${jobId}.jsonl`);
    const lines = entries.map((entry) => JSON.stringify(entry)).join("\n");
    fs.writeFileSync(logPath, `${lines}\n`, "utf8");
    console.log(`  ✓ ${jobId} (${entries.length} runs)`);
  }

  console.log("\n🤖 Writing subagent mock data...");
  writeJson(SUBAGENT_RUNS_FILE, sampleSubagentRuns);
  writeJson(SUBAGENT_SESSIONS_FILE_MAIN, sampleSubagentSessionsMain);
  writeJson(SUBAGENT_SESSIONS_FILE_RESEARCH, sampleSubagentSessionsResearch);
  console.log(`  ✓ runs: ${Object.keys(sampleSubagentRuns.runs).length}`);
  console.log(`  ✓ sessions(main): ${Object.keys(sampleSubagentSessionsMain).length}`);
  console.log(`  ✓ sessions(research): ${Object.keys(sampleSubagentSessionsResearch).length}`);

  console.log("\n🚀 Start the dashboard with: npm run dev:logs-dashboard\n");

  db.close();
} catch (error) {
  console.error("❌ Seeding failed:", error);
  process.exit(1);
}
