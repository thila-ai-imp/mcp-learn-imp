declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

interface AgentItem { id: string; name: string; description: string }
interface CallUsage {
  label: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  ms: number;
}
interface UsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}
type HostMessage =
  | { type: 'init'; agents: AgentItem[]; model: string; ready: boolean }
  | { type: 'progress'; text: string }
  | { type: 'usage'; call: CallUsage; totals: UsageTotals }
  | { type: 'done'; fileName: string; stats: { testCases: number; modules: number }; totals: UsageTotals }
  | { type: 'error'; text: string };

const vscodeApi = acquireVsCodeApi();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const messages = $<HTMLDivElement>('messages');
const form = $<HTMLFormElement>('composer');
const drop = $<HTMLDivElement>('drop');
const dropText = $<HTMLSpanElement>('dropText');
const fileInput = $<HTMLInputElement>('file');
const agentSel = $<HTMLSelectElement>('agent');
const agentBtn = $<HTMLButtonElement>('agentBtn');
const agentMenu = $<HTMLUListElement>('agentMenu');
const agentName = $<HTMLElement>('agentName');
const agentDesc = $<HTMLElement>('agentDesc');
const goBtn = $<HTMLButtonElement>('go');
const badge = $<HTMLSpanElement>('providerBadge');

const ICO = {
  bot: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="3" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="13" r="1.3" fill="currentColor"/><circle cx="15" cy="13" r="1.3" fill="currentColor"/><path d="M12 8V5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="4" r="1.2" fill="currentColor"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 19c1.2-3.2 3.5-5 6.5-5s5.3 1.8 6.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  status: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="currentColor"/></svg>',
};

let file: File | null = null;
let busy = false;
let agents: AgentItem[] = [];
const fmt = (n: number) => n.toLocaleString();

function svg(html: string): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = html;
  return wrap;
}

function addMsg(role: 'bot' | 'user', text = '', error = false): HTMLDivElement {
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = role === 'bot' ? ICO.bot : ICO.user;
  const el = document.createElement('div');
  el.className = `msg ${role}${error ? ' error' : ''}`;
  if (text) el.textContent = text;
  row.append(avatar, el);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function typingBubble(): { step: (t: string) => void; stop: () => void; fail: () => void } {
  const el = addMsg('bot');
  const list = document.createElement('ul');
  list.className = 'steps';
  el.appendChild(list);
  return {
    step(t) {
      list.querySelector('li.live')?.classList.remove('live');
      const li = document.createElement('li');
      li.textContent = t;
      li.className = 'live';
      list.appendChild(li);
      messages.scrollTop = messages.scrollHeight;
    },
    stop() { list.querySelector('li.live')?.classList.remove('live'); },
    fail() { el.classList.add('error'); this.stop(); },
  };
}

function setTotals(t: UsageTotals) {
  $('tPrompt').textContent = fmt(t.promptTokens);
  $('tCompletion').textContent = fmt(t.completionTokens);
  $('tTotal').textContent = fmt(t.totalTokens);
  $('usageNote').textContent = `${t.calls} Copilot call(s)${t.estimated ? ' · some counts are estimates' : ''}`;
}

function addCallRow(c: CallUsage) {
  const tr = document.createElement('tr');
  for (const [text, cls] of [
    [c.label, 'step'],
    [fmt(c.promptTokens), 'num'],
    [fmt(c.completionTokens), 'num'],
    [(c.ms / 1000).toFixed(1) + 's', 'num'],
  ] as const) {
    const td = document.createElement('td');
    td.textContent = text;
    td.className = cls;
    tr.appendChild(td);
  }
  $('calls').appendChild(tr);
}

function resetUsage() {
  $('calls').replaceChildren();
  $('tPrompt').textContent = '0';
  $('tCompletion').textContent = '0';
  $('tTotal').textContent = '0';
  $('usageNote').textContent = 'Waiting for GitHub Copilot…';
}

function refresh() { goBtn.disabled = busy || !file || !agentSel.value; }

function selectedAgent(): AgentItem | undefined {
  return agents.find((a) => a.id === agentSel.value);
}

function setAgent(id: string) {
  const agent = agents.find((a) => a.id === id);
  if (!agent) return;
  agentSel.value = agent.id;
  agentName.textContent = agent.name;
  agentDesc.textContent = agent.description || 'Custom Copilot agent';
  for (const btn of agentMenu.querySelectorAll<HTMLButtonElement>('.agent-option')) {
    btn.setAttribute('aria-selected', String(btn.dataset.id === agent.id));
  }
  refresh();
}

function closeMenu() {
  agentMenu.hidden = true;
  agentBtn.classList.remove('open');
  agentBtn.setAttribute('aria-expanded', 'false');
}

function openMenu() {
  agentMenu.hidden = false;
  agentBtn.classList.add('open');
  agentBtn.setAttribute('aria-expanded', 'true');
}

function renderAgents() {
  agentSel.replaceChildren();
  agentMenu.replaceChildren();
  for (const a of agents) {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.name;
    agentSel.appendChild(o);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agent-option';
    btn.dataset.id = a.id;
    const title = document.createElement('b');
    title.textContent = a.name;
    const desc = document.createElement('span');
    desc.textContent = a.description || 'Custom Copilot agent';
    btn.append(title, desc);
    btn.addEventListener('click', () => {
      setAgent(a.id);
      closeMenu();
    });
    li.appendChild(btn);
    agentMenu.appendChild(li);
  }
  if (agents[0]) setAgent(agents[0].id);
  else {
    agentName.textContent = 'No custom agent';
    agentDesc.textContent = 'Add a .agent.md file under .github/agents';
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const next = e.dataTransfer?.files?.[0];
  if (!next) return;
  fileInput.files = e.dataTransfer.files;
  fileInput.dispatchEvent(new Event('change'));
});
fileInput.addEventListener('change', () => {
  const next = fileInput.files?.[0] ?? null;
  if (next && !/\.xlsx$/i.test(next.name)) {
    addMsg('bot', 'That file is not an .xlsx workbook.', true);
    return;
  }
  file = next;
  drop.classList.toggle('has', !!file);
  dropText.textContent = file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : 'Drop an .xlsx file here or click to choose';
  refresh();
});

agentBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (agentMenu.hidden) openMenu();
  else closeMenu();
});
document.addEventListener('click', (e) => {
  if (!agentBtn.contains(e.target as Node) && !agentMenu.contains(e.target as Node)) closeMenu();
});

let bubble: ReturnType<typeof typingBubble> | null = null;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!file || busy) return;
  const agent = selectedAgent();
  if (!agent) return;
  busy = true;
  refresh();
  resetUsage();
  addMsg('user', `Generate a knowledge document from ${file.name}\nAgent: ${agent.name}`);
  bubble = typingBubble();
  bubble.step('Sending the workbook to GitHub Copilot…');
  const base64 = toBase64(await file.arrayBuffer());
  vscodeApi.postMessage({ type: 'generate', agentId: agent.id, fileName: file.name, base64 });
});

function download(fileName: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dl';
  button.append(svg(ICO.download), document.createTextNode(` Download ${fileName}`));
  button.addEventListener('click', () => vscodeApi.postMessage({ type: 'save' }));
  return button;
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'init') {
    agents = msg.agents;
    badge.className = `badge ${msg.ready ? 'ready' : 'warn'}`;
    badge.replaceChildren();
    badge.append(svg(ICO.status), document.createTextNode(msg.ready ? ` GitHub Copilot · ${msg.model}` : ' Sign in to GitHub Copilot'));
    renderAgents();
    addMsg('bot', agents.length
      ? `KnowledgeAgent runs your custom agent with the GitHub Copilot already signed in to VS Code.\n\n1. Choose your .xlsx file\n2. Pick a custom agent\n3. Press Generate document\n\n${msg.ready ? 'Copilot is ready.' : 'Sign in to GitHub Copilot in this VS Code window, then run KnowledgeAgent: Open again.'}`
      : 'No custom agents found. Add a .agent.md file under .github/agents and open KnowledgeAgent again.', !agents.length);
    refresh();
    return;
  }
  if (msg.type === 'progress') bubble?.step(msg.text);
  if (msg.type === 'usage') { addCallRow(msg.call); setTotals(msg.totals); }
  if (msg.type === 'error') {
    bubble?.fail();
    bubble?.step(msg.text);
    busy = false;
    bubble = null;
    refresh();
  }
  if (msg.type === 'done') {
    bubble?.stop();
    setTotals(msg.totals);
    const done = addMsg('bot', 'Your document is ready.');
    const stats = document.createElement('div');
    stats.className = 'stats';
    stats.textContent = `${msg.stats.testCases} test cases · ${msg.stats.modules} module(s) · ${fmt(msg.totals.totalTokens)} tokens`;
    const where = document.createElement('div');
    where.className = 'hint';
    where.textContent = `A copy is already in .testdoc/output/${msg.fileName}`;
    done.append(stats, where, download(msg.fileName));
    busy = false;
    bubble = null;
    refresh();
  }
});

vscodeApi.postMessage({ type: 'ready' });
