import * as path from 'path';
import * as vscode from 'vscode';
import { generateDocument, listWorkspaceAgents, selectCopilotModel, type GenCall } from './run';

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function projectRoot(context: vscode.ExtensionContext): string | undefined {
  return workspaceRoot()
    ?? (context.extensionMode === vscode.ExtensionMode.Development ? context.extensionPath : undefined);
}

const ICO = {
  sparkle: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.2 5.2L18 9.5l-4.8 1.3L12 16l-1.2-5.2L6 9.5l4.8-1.3L12 3z" fill="currentColor"/><path d="M18.5 14.5l.6 2.4 2.4.6-2.4.6-.6 2.4-.6-2.4-2.4-.6 2.4-.6.6-2.4z" fill="currentColor" opacity=".85"/></svg>',
  bot: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="3" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="13" r="1.3" fill="currentColor"/><circle cx="15" cy="13" r="1.3" fill="currentColor"/><path d="M12 8V5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="4" r="1.2" fill="currentColor"/><path d="M8 19v1.5M16 19v1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  sheet: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2.2" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19V9M12 19V5M19 19v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  status: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="currentColor"/></svg>',
};

function html(webview: vscode.Webview, styleUri: vscode.Uri, scriptUri: vscode.Uri): string {
  const nonce = String(Date.now());
  const csp = webview.cspSource;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data:; style-src ${csp} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KnowledgeAgent</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="logo" aria-hidden="true">${ICO.sparkle}</span>
        <div>
          <h1>KnowledgeAgent</h1>
          <p>GenAI document writer for custom Copilot agents</p>
        </div>
      </div>
      <span id="providerBadge" class="badge">${ICO.status} connecting…</span>
    </header>
    <main class="layout">
      <section class="chat" aria-label="Conversation">
        <div id="messages" class="messages" role="log" aria-live="polite"></div>
        <form id="composer" class="composer">
          <div id="drop" class="drop" tabindex="0" role="button" aria-label="Choose Excel file">
            <input id="file" type="file" accept=".xlsx" hidden>
            ${ICO.sheet}
            <span id="dropText">Drop an .xlsx file here or click to choose</span>
          </div>
          <div class="row">
            <div class="agent-picker">
              <span class="field-label">${ICO.bot} Custom agent</span>
              <button type="button" id="agentBtn" class="agent-btn" aria-haspopup="listbox" aria-expanded="false">
                <span class="agent-ico">${ICO.bot}</span>
                <span class="agent-meta">
                  <strong id="agentName">Select an agent</strong>
                  <small id="agentDesc">No custom agent selected</small>
                </span>
                <span class="chevron">${ICO.chevron}</span>
              </button>
              <ul id="agentMenu" class="agent-menu" hidden role="listbox"></ul>
              <select id="agent" class="sr-only" tabindex="-1" aria-hidden="true"></select>
            </div>
            <button id="go" type="submit" class="primary" disabled>${ICO.sparkle} Generate document</button>
          </div>
        </form>
      </section>
      <aside class="usage" aria-label="Token usage">
        <h2>${ICO.chart} Token usage</h2>
        <div class="totals">
          <div><span id="tPrompt">0</span><small>Prompt</small></div>
          <div><span id="tCompletion">0</span><small>Completion</small></div>
          <div><span id="tTotal">0</span><small>Total</small></div>
        </div>
        <p id="usageNote" class="hint">No model calls yet.</p>
        <table>
          <thead><tr><th>Step</th><th class="num">In</th><th class="num">Out</th><th class="num">Time</th></tr></thead>
          <tbody id="calls"></tbody>
        </table>
      </aside>
    </main>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('knowledgeagent.open', () => {
    const root = projectRoot(context);
    if (!root) {
      void vscode.window.showErrorMessage('Open the KnowledgeAgent folder first.');
      return;
    }

    const panel = vscode.window.createWebviewPanel('knowledgeagent', 'KnowledgeAgent', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist'), vscode.Uri.joinPath(context.extensionUri, 'public')],
    });
    const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'public', 'styles.css'));
    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'));
    panel.webview.html = html(panel.webview, styleUri, scriptUri);

    const post = (message: unknown) => panel.webview.postMessage(message);
    let busy = false;
    let saved: { name: string; bytes: Uint8Array } | undefined;

    const sendInit = async () => {
      const agents = listWorkspaceAgents(root, context.extensionPath).map(({ id, name, description }) => ({ id, name, description }));
      let modelName = 'GitHub Copilot';
      let ready = false;
      try {
        const model = await selectCopilotModel(new vscode.CancellationTokenSource().token);
        modelName = model.name || model.family || 'GitHub Copilot';
        ready = true;
      } catch {
        ready = false;
      }
      post({ type: 'init', agents, model: modelName, ready });
    };

    panel.webview.onDidReceiveMessage(async (message: { type?: string; fileName?: string; base64?: string; agentId?: string }) => {
      if (message.type === 'ready') {
        await sendInit();
        return;
      }
      if (message.type === 'save') {
        if (!saved) {
          void vscode.window.showErrorMessage('Generate a document first.');
          return;
        }
        const target = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(root, '.testdoc', 'output', saved.name)),
          filters: { 'Word document': ['docx'] },
          saveLabel: 'Save document',
        });
        if (!target) return;
        try {
          await vscode.workspace.fs.writeFile(target, saved.bytes);
          const choice = await vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}`, 'Show in folder');
          if (choice === 'Show in folder') await vscode.commands.executeCommand('revealFileInOS', target);
        } catch (e) {
          void vscode.window.showErrorMessage((e as Error).message);
        }
        return;
      }
      if (message.type !== 'generate' || busy) return;
      const agent = listWorkspaceAgents(root, context.extensionPath).find((a) => a.id === message.agentId);
      if (!agent || !message.base64 || !message.fileName) {
        post({ type: 'error', text: 'Choose an Excel file and an agent.' });
        return;
      }
      busy = true;
      const cts = new vscode.CancellationTokenSource();
      const calls: GenCall[] = [];
      const totals = () => calls.reduce((t, c) => ({
        calls: t.calls + 1,
        promptTokens: t.promptTokens + c.promptTokens,
        completionTokens: t.completionTokens + c.completionTokens,
        totalTokens: t.totalTokens + c.totalTokens,
        estimated: t.estimated || c.estimated,
      }), { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: false });
      try {
        const model = await selectCopilotModel(cts.token);
        const result = await generateDocument({
          root,
          kitRoot: context.extensionPath,
          agent,
          fileName: message.fileName,
          bytes: Buffer.from(message.base64, 'base64'),
          model,
          token: cts.token,
          onProgress: (text) => post({ type: 'progress', text }),
          onCall: (call) => {
            calls.push(call);
            post({ type: 'usage', call, totals: totals() });
          },
        });
        saved = { name: result.downloadName, bytes: Uint8Array.from(result.docx) };
        post({
          type: 'done',
          fileName: result.downloadName,
          stats: result.stats,
          totals: totals(),
        });
      } catch (e) {
        post({ type: 'error', text: (e as Error).message });
      } finally {
        cts.dispose();
        busy = false;
      }
    }, undefined, context.subscriptions);
  });

  context.subscriptions.push(command);

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    if (!workspaceRoot()) {
      vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.file(context.extensionPath) });
    }
    setTimeout(() => {
      void vscode.commands.executeCommand('knowledgeagent.open');
    }, 400);
  }
}

export function deactivate(): void {}
