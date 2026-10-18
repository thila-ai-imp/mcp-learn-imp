import type { CallUsage, StreamEvent, UsageTotals } from '../core/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const messages = $<HTMLDivElement>('messages');
const form = $<HTMLFormElement>('composer');
const drop = $<HTMLDivElement>('drop');
const dropText = $<HTMLSpanElement>('dropText');
const fileInput = $<HTMLInputElement>('file');
const agentSel = $<HTMLSelectElement>('agent');
const agentDesc = $<HTMLParagraphElement>('agentDesc');
const goBtn = $<HTMLButtonElement>('go');
const badge = $<HTMLSpanElement>('providerBadge');

let file: File | null = null;
let busy = false;
let agents: Array<{ id: string; name: string; description: string }> = [];
let maxMb = 20;

const fmt = (n: number) => n.toLocaleString();

/* ---------- chat helpers (textContent only, never innerHTML) ---------- */
function addMsg(role: 'bot' | 'user', text = '', error = false): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `msg ${role}${error ? ' error' : ''}`;
  if (text) el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function typingBubble(): { el: HTMLDivElement; step: (t: string) => void; stop: () => void } {
  const el = addMsg('bot');
  const dots = document.createElement('span');
  dots.className = 'typing';
  dots.innerHTML = '<i></i><i></i><i></i>';
  const list = document.createElement('ul');
  list.className = 'steps';
  el.append(dots, list);
  return {
    el,
    step(t) {
      list.querySelector('li.live')?.classList.remove('live');
      const li = document.createElement('li');
      li.textContent = t;
      li.className = 'live';
      list.appendChild(li);
      messages.scrollTop = messages.scrollHeight;
    },
    stop() {
      dots.remove();
      list.querySelector('li.live')?.classList.remove('live');
    },
  };
}

/* ---------- usage panel ---------- */
function setTotals(t: UsageTotals) {
  $('tPrompt').textContent = fmt(t.promptTokens);
  $('tCompletion').textContent = fmt(t.completionTokens);
  $('tTotal').textContent = fmt(t.totalTokens);
  $('usageNote').textContent = `${t.calls} model call(s)${t.estimated ? ' · some counts are estimates (provider did not report usage)' : ''}`;
}
function addCallRow(c: CallUsage) {
  const tr = document.createElement('tr');
  const cells: Array<[string, string]> = [
    [c.label, 'step'], [fmt(c.promptTokens), 'num'], [fmt(c.completionTokens), 'num'], [(c.ms / 1000).toFixed(1) + 's', 'num'],
  ];
  for (const [text, cls] of cells) {
    const td = document.createElement('td');
    td.textContent = text;
    td.className = cls;
    if (cls === 'step') td.title = text;
    tr.appendChild(td);
  }
  $('calls').appendChild(tr);
}
function resetUsage() {
  $('calls').replaceChildren();
  setTotals({ calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: false });
  $('usageNote').textContent = 'Waiting for GitHub Copilot…';
}

/* ---------- file selection ---------- */
function setFile(f: File | null) {
  if (f && !/\.xlsx$/i.test(f.name)) {
    addMsg('bot', 'That file is not an .xlsx workbook. Please save it as .xlsx and try again.', true);
    return;
  }
  if (f && f.size > maxMb * 1024 * 1024) {
    addMsg('bot', `That file is larger than ${maxMb} MB.`, true);
    return;
  }
  file = f;
  drop.classList.toggle('has', !!f);
  dropText.textContent = f ? `${f.name} (${(f.size / 1024).toFixed(0)} KB)` : 'Drop an .xlsx file here or click to choose';
  refresh();
}
function refresh() { goBtn.disabled = busy || !file || !agentSel.value; }

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => setFile(fileInput.files?.[0] ?? null));
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => setFile((e as DragEvent).dataTransfer?.files?.[0] ?? null));
agentSel.addEventListener('change', () => {
  agentDesc.textContent = agents.find((a) => a.id === agentSel.value)?.description ?? '';
  refresh();
});

/* ---------- generate ---------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!file || busy) return;
  busy = true;
  refresh();
  resetUsage();

  const agent = agents.find((a) => a.id === agentSel.value)!;
  addMsg('user', `Generate a knowledge document from ${file.name}\nAgent: ${agent.name}`);
  const bubble = typingBubble();

  try {
    const body = new FormData();
    body.append('agentId', agent.id);
    body.append('file', file);
    const res = await fetch('/api/generate', { method: 'POST', body });
    if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let finished = false;

    const handle = (ev: StreamEvent) => {
      if (ev.type === 'progress') bubble.step(ev.text);
      else if (ev.type === 'usage') { addCallRow(ev.call); setTotals(ev.totals); }
      else if (ev.type === 'error') { bubble.stop(); bubble.el.classList.add('error'); bubble.step(ev.text); bubble.stop(); finished = true; }
      else if (ev.type === 'done') {
        finished = true;
        bubble.stop();
        setTotals(ev.totals);
        const done = addMsg('bot', 'Your document is ready.');
        const stats = document.createElement('div');
        stats.className = 'stats';
        stats.textContent = `${ev.stats.testCases} test cases · ${ev.stats.modules} module(s) · ${fmt(ev.totals.totalTokens)} tokens`;
        const a = document.createElement('a');
        a.className = 'dl';
        a.href = ev.downloadUrl;
        a.download = ev.fileName;
        a.textContent = `Download ${ev.fileName}`;
        done.append(stats, document.createElement('br'), a);
        messages.scrollTop = messages.scrollHeight;
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handle(JSON.parse(line) as StreamEvent);
      }
    }
    if (!finished) throw new Error('The connection closed before the document was finished.');
  } catch (err) {
    bubble.stop();
    bubble.el.classList.add('error');
    bubble.step((err as Error).message);
    bubble.stop();
  } finally {
    busy = false;
    refresh();
  }
});

/* ---------- init ---------- */
async function init() {
  try {
    const [cfg, list] = await Promise.all([
      fetch('/api/config').then((r) => r.json()),
      fetch('/api/agents').then((r) => r.json()),
    ]);
    maxMb = cfg.maxUploadMb;
    agents = list;
    badge.textContent = cfg.copilotCli ? `GitHub Copilot · ${cfg.model}` : 'GitHub Copilot · CLI not installed';
    for (const a of agents) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.name;
      agentSel.appendChild(o);
    }
    agentDesc.textContent = agents[0]?.description ?? '';
    const how = `GitHub Copilot runs the agent you pick, using the Copilot subscription from \`copilot\` sign-in.${cfg.copilotCli ? '' : '\n\nCopilot CLI is not installed. Install it with: winget install --id GitHub.Copilot  then run: copilot'}${cfg.proxy ? '' : '\n\nNo HTTPS_PROXY is set. On the corporate network, set HTTPS_PROXY and, if TLS is inspected, NODE_EXTRA_CA_CERTS, then start the server again.'}`;
    addMsg('bot', agents.length
      ? `Hi! I turn Excel test cases into an Application Knowledge document.\n\n1. Choose your .xlsx file\n2. Pick a GitHub Copilot agent\n3. Press Generate document\n\n${how}`
      : 'No Copilot agents found. Add a .agent.md file under .github/agents/ and reload.', !agents.length);
    resetUsage();
  } catch {
    badge.textContent = 'server unreachable';
    addMsg('bot', 'Cannot reach the local server. Is it running?', true);
  }
  refresh();
}
void init();
