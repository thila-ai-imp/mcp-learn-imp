import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { loadAgents } from '../core/agents';
import { estimateTokens, proxySummary, resolveCopilotBin, runCopilot } from '../core/copilotCli';
import { loadDotEnv } from '../core/dotenv';
import { readTestCases } from '../core/excelReader';
import type { AgentDef, CallUsage, StreamEvent, UsageTotals } from '../core/types';

const ROOT = path.join(__dirname, '..');
loadDotEnv(path.join(ROOT, '.env'));

const COPILOT_AGENTS_DIR = process.env.COPILOT_AGENTS_DIR || path.join(ROOT, '.github', 'agents');
const PORT = Number(process.env.PORT || 3000);
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 20);
const COPILOT_MODEL = process.env.COPILOT_MODEL || 'subscription default';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024 } });

// generated documents are kept in memory for 30 minutes
const files = new Map<string, { name: string; buf: Buffer; expires: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of files) if (v.expires < now) files.delete(k);
}, 60_000).unref();

let copilotAgentBusy = false;

function listAgents(): AgentDef[] {
  return loadAgents(COPILOT_AGENTS_DIR);
}

function safeWorkbookName(original: string): string {
  const base = path.basename(original).replace(/[^\w.\- ()]+/g, '_');
  return /\.xlsx$/i.test(base) ? base : `${base}.xlsx`;
}

function newestDocx(dir: string, sinceMs: number): string | null {
  if (!fs.existsSync(dir)) return null;
  const found = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.docx'))
    .map((f) => {
      const full = path.join(dir, f);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .filter((f) => f.mtime >= sinceMs - 1000)
    .sort((a, b) => b.mtime - a.mtime);
  return found[0]?.full ?? null;
}

async function runCopilotAgent(
  agent: AgentDef,
  fileName: string,
  buffer: Buffer,
  testCaseCount: number,
  moduleCount: number,
  send: (e: StreamEvent) => void
): Promise<void> {
  if (copilotAgentBusy) throw new Error('A Copilot agent is already running. Wait for it to finish, then try again.');

  copilotAgentBusy = true;
  const started = Date.now();
  try {
    const inputDir = path.join(ROOT, '.testdoc', 'input');
    fs.mkdirSync(inputDir, { recursive: true });
    const inputPath = path.join(inputDir, safeWorkbookName(fileName));
    fs.writeFileSync(inputPath, buffer);

    send({ type: 'progress', text: `Handing ${path.basename(inputPath)} to GitHub Copilot agent “${agent.copilotAgent}”…` });
    const output = await runCopilot({
      cwd: ROOT,
      prompt: `Generate the document from ${inputPath}`,
      agent: agent.copilotAgent,
      model: process.env.COPILOT_MODEL || undefined,
      timeoutMs: Number(process.env.COPILOT_AGENT_TIMEOUT_MS || 30 * 60_000),
      onLine: (line) => send({ type: 'progress', text: line }),
    });

    const docxPath = newestDocx(path.join(ROOT, '.testdoc', 'output'), started);
    if (!docxPath) {
      const tail = output.split(/\n/).slice(-8).join(' ').slice(0, 500);
      throw new Error(`Copilot finished without a Word file in .testdoc/output. ${tail}`.trim());
    }

    const buf = fs.readFileSync(docxPath);
    const id = crypto.randomUUID();
    const downloadName = path.basename(docxPath);
    files.set(id, { name: downloadName, buf, expires: Date.now() + 30 * 60_000 });
    const promptTokens = estimateTokens(output);
    const completionTokens = estimateTokens(output);
    const totals: UsageTotals = {
      calls: 1,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimated: true,
    };
    const usageCall: CallUsage = {
      label: agent.name,
      ms: Date.now() - started,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimated: true,
    };
    send({ type: 'usage', call: usageCall, totals });
    send({
      type: 'done',
      downloadUrl: `/api/download/${id}`,
      fileName: downloadName,
      stats: { testCases: testCaseCount, modules: moduleCount },
      totals,
      calls: [usageCall],
    });
  } finally {
    copilotAgentBusy = false;
  }
}

const app = express();
app.disable('x-powered-by');

// everything the browser needs is served from here: no CDN, no external calls
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/config', (_req, res) => {
  const proxy = proxySummary();
  res.json({
    provider: 'github-copilot',
    model: COPILOT_MODEL,
    offline: false,
    maxUploadMb: MAX_MB,
    copilotCli: Boolean(resolveCopilotBin()),
    proxy: proxy.configured ? proxy.label : '',
  });
});

app.get('/api/agents', (_req, res) => {
  res.json(listAgents().map(({ id, name, description }) => ({ id, name, description })));
});

app.post('/api/generate', upload.single('file'), async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const send = (e: StreamEvent) => res.write(JSON.stringify(e) + '\n');

  try {
    const file = req.file;
    if (!file) throw new Error('No file uploaded.');
    if (!/\.xlsx$/i.test(file.originalname)) throw new Error('Please upload an .xlsx file (save .xls/.csv as .xlsx first).');

    const agent = listAgents().find((a) => a.id === req.body.agentId);
    if (!agent) throw new Error('Selected agent was not found.');

    send({ type: 'progress', text: `Reading ${file.originalname}…` });
    const testCases = await readTestCases(file.buffer);
    if (!testCases.length) throw new Error('No test cases found. Check that the sheet has a header row with columns like Test Case ID, Module, Steps, Expected Result.');

    const moduleCount = new Set(testCases.map((t) => t.module || 'General')).size;
    await runCopilotAgent(agent, file.originalname, file.buffer, testCases.length, moduleCount, send);
  } catch (e) {
    send({ type: 'error', text: (e as Error).message });
  } finally {
    res.end();
  }
});

app.get('/api/download/:id', (req, res) => {
  const f = files.get(req.params.id);
  if (!f) { res.status(404).send('This download has expired. Please generate the document again.'); return; }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="document.docx"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.send(f.buf);
});

app.listen(PORT, '127.0.0.1', () => {
  const proxy = proxySummary();
  const cli = resolveCopilotBin();
  const ca = process.env.NODE_EXTRA_CA_CERTS;
  console.log(`knowledgeagent running at http://localhost:${PORT}  (GitHub Copilot, model: ${COPILOT_MODEL})`);
  console.log(cli ? `GitHub Copilot CLI: ${cli}` : 'GitHub Copilot CLI not found. Install with: winget install --id GitHub.Copilot');
  console.log(proxy.configured ? `Proxy: ${proxy.label}` : 'Proxy: none (set HTTPS_PROXY on the corporate network)');
  if (ca) console.log(fs.existsSync(ca) ? `Extra CA: ${ca}` : `NODE_EXTRA_CA_CERTS file not found: ${ca}`);
});
