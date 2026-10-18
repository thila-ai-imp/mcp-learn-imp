import fs from 'node:fs';
import path from 'node:path';
import type { AgentDef } from './types';

function parseFrontmatter(text: string): Record<string, string> {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};
  const out: Record<string, string> = {};
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

/** Custom agents from `.github/agents/*.agent.md`. */
export function loadAgents(dir: string): AgentDef[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.agent.md'))
    .map((f) => {
      const file = path.join(dir, f);
      const text = fs.readFileSync(file, 'utf8');
      const meta = parseFrontmatter(text);
      const stem = f.replace(/\.agent\.md$/i, '');
      const name = meta.name || stem;
      return {
        id: stem,
        name,
        description: meta.description || 'GitHub Copilot custom agent',
        copilotAgent: name,
        file,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function loadAgentsFromRoots(roots: string[]): AgentDef[] {
  const seen = new Set<string>();
  const out: AgentDef[] = [];
  for (const root of roots) {
    if (!root) continue;
    for (const dir of [path.join(root, '.github', 'agents'), path.join(root, 'agents')]) {
      for (const agent of loadAgents(dir)) {
        if (seen.has(agent.id)) continue;
        seen.add(agent.id);
        out.push(agent);
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
