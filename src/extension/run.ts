import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { loadAgentsFromRoots } from '../core/agents';
import type { AgentDef } from '../core/types';

export interface GenStats {
  testCases: number;
  modules: number;
}

export interface GenCall {
  label: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  ms: number;
}

interface WorkPart {
  file: string;
  analysis: string;
}

interface WorkIndex {
  source: string;
  testCases: number;
  modules: Array<{ name: string; parts: WorkPart[] }>;
}

const est = (s: string) => Math.ceil(s.length / 4);

function runNode(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { cwd, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { out += c; });
    child.stderr.on('data', (c: string) => { err += c; });
    child.on('error', (e) => reject(new Error(`Node.js is required to read Excel and build the Word file. ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error((err || out || `node exited with code ${code}`).trim()));
    });
  });
}

function shellWords(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

function buildArgs(agentText: string): string[] {
  const line = agentText.match(/node\s+\.github\/testdoc\/build-docx\.cjs[^\n`]*/);
  if (!line) return ['.testdoc/work', '--suffix', 'knowledge'];
  const words = shellWords(line[0]);
  const scriptAt = words.findIndex((w) => w.includes('build-docx.cjs'));
  return words.slice(scriptAt + 1);
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Copilot did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function tokenCount(model: vscode.LanguageModelChat, text: string, token: vscode.CancellationToken): Promise<{ n: number; estimated: boolean }> {
  try {
    return { n: await model.countTokens(text, token), estimated: false };
  } catch {
    return { n: est(text), estimated: true };
  }
}

async function ask(
  model: vscode.LanguageModelChat,
  instructions: string,
  user: string,
  token: vscode.CancellationToken
): Promise<{ text: string; promptTokens: number; completionTokens: number; estimated: boolean; ms: number }> {
  const prompt = `${instructions}\n\n${user}\n\nReturn only one JSON object. No code fences and no explanation.`;
  const started = Date.now();
  const promptCount = await tokenCount(model, prompt, token);
  const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
  let text = '';
  for await (const part of response.text) text += part;
  const completionCount = await tokenCount(model, text, token);
  return {
    text,
    promptTokens: promptCount.n,
    completionTokens: completionCount.n,
    estimated: promptCount.estimated || completionCount.estimated,
    ms: Date.now() - started,
  };
}

function safeName(original: string): string {
  const base = path.basename(original).replace(/[^\w.\- ()]+/g, '_');
  return /\.xlsx$/i.test(base) ? base : `${base}.xlsx`;
}

export function listWorkspaceAgents(...roots: string[]): AgentDef[] {
  return loadAgentsFromRoots(roots);
}

function kitScript(root: string, extraRoot: string | undefined, name: string): string {
  const hits = [
    path.join(root, '.github', 'testdoc', name),
    extraRoot ? path.join(extraRoot, '.github', 'testdoc', name) : '',
    path.join(root, 'scripts', 'testdoc', name),
  ].filter(Boolean);
  const found = hits.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`Missing ${name}. Keep the .github folder when you copy KnowledgeAgent.`);
  }
  return found;
}

export async function selectCopilotModel(token: vscode.CancellationToken): Promise<vscode.LanguageModelChat> {
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (!models.length) {
    throw new Error('GitHub Copilot is not available. Sign in to GitHub Copilot in VS Code, allow KnowledgeAgent to use it, then try again.');
  }
  void token;
  return models[0];
}

export async function generateDocument(options: {
  root: string;
  kitRoot?: string;
  agent: AgentDef;
  fileName: string;
  bytes: Buffer;
  model: vscode.LanguageModelChat;
  token: vscode.CancellationToken;
  onProgress: (text: string) => void;
  onCall: (call: GenCall) => void;
}): Promise<{ docx: Buffer; downloadName: string; stats: GenStats }> {
  const { root, agent, model, token, onProgress, onCall } = options;
  const agentPath = agent.file || path.join(root, '.github', 'agents', `${agent.id}.agent.md`);
  const agentText = fs.readFileSync(agentPath, 'utf8');
  const instructions = agentText.replace(/^---[\s\S]*?---\s*/, '');

  const inputDir = path.join(root, '.testdoc', 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  const inputPath = path.join(inputDir, safeName(options.fileName));
  fs.writeFileSync(inputPath, options.bytes);

  onProgress('Reading the Excel file…');
  const readOut = await runNode(root, [kitScript(root, options.kitRoot, 'read-excel.cjs'), inputPath]);
  if (/^ERROR/m.test(readOut)) throw new Error(readOut.trim());

  const indexPath = path.join(root, '.testdoc', 'work', 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as WorkIndex;
  const parts = index.modules.flatMap((m) => m.parts.map((p) => ({ module: m.name, ...p })));
  onProgress(`Split into ${parts.length} part(s) across ${index.modules.length} module(s).`);

  for (let i = 0; i < parts.length; i++) {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    const part = parts[i];
    const label = `${part.module} (${i + 1}/${parts.length})`;
    onProgress(`Copilot is analysing ${label}…`);
    const body = fs.readFileSync(path.join(root, '.testdoc', 'work', part.file), 'utf8');
    let written = false;
    let lastErr = '';
    for (let attempt = 1; attempt <= 2 && !written; attempt++) {
      const result = await ask(
        model,
        instructions,
        `Analyse this part of the test cases for module "${part.module}". Write the analysis JSON described in your procedure and nothing else.\n\n${body}${attempt === 2 ? '\n\nThe previous reply was not valid JSON. Return only one JSON object.' : ''}`,
        token
      );
      onCall({
        label,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.promptTokens + result.completionTokens,
        estimated: result.estimated,
        ms: result.ms,
      });
      try {
        const json = extractJson(result.text);
        const target = path.join(root, '.testdoc', 'work', part.analysis);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(json, null, 2));
        written = true;
      } catch (e) {
        lastErr = (e as Error).message;
      }
    }
    if (!written) throw new Error(`Copilot returned unusable JSON for ${label}. ${lastErr}`);
  }

  onProgress('Copilot is writing the overview…');
  const digest = index.modules.map((m) => m.name).join(', ');
  const overview = await ask(
    model,
    instructions,
    `The modules are: ${digest}. Write overview.json exactly as your procedure describes. Return only that JSON object.`,
    token
  );
  onCall({
    label: 'Overview',
    promptTokens: overview.promptTokens,
    completionTokens: overview.completionTokens,
    totalTokens: overview.promptTokens + overview.completionTokens,
    estimated: overview.estimated,
    ms: overview.ms,
  });
  const overviewJson = extractJson(overview.text);
  fs.writeFileSync(path.join(root, '.testdoc', 'work', 'overview.json'), JSON.stringify(overviewJson, null, 2));

  onProgress('Building the Word document…');
  const args = buildArgs(agentText);
  const built = await runNode(root, [kitScript(root, options.kitRoot, 'build-docx.cjs'), ...args]);
  const created = built.match(/DOCUMENT_CREATED\s+(\S+)/);
  const outputDir = path.join(root, '.testdoc', 'output');
  let docxPath = created ? path.resolve(root, created[1]) : '';
  if (!docxPath || !fs.existsSync(docxPath)) {
    const newest = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter((f) => f.endsWith('.docx')).map((f) => path.join(outputDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
      : '';
    if (!newest) throw new Error('The Word file was not created.');
    docxPath = newest;
  }
  return {
    docx: fs.readFileSync(docxPath),
    downloadName: path.basename(docxPath),
    stats: { testCases: index.testCases, modules: index.modules.length },
  };
}
