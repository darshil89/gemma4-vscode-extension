import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const provider = new GemmaChatProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('gemmaChat', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gemma.openChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.gemma-chat');
    })
  );
}

class GemmaChatProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = { enableScripts: true };
    view.webview.html = getWebviewHTML();

    view.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'chat') {
        // Stream response from Ollama
        const response = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gemma4:e4b',
            messages: msg.history,
            stream: true,
          }),
        });

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) { break; }

          const lines = decoder.decode(value).split('\n').filter(Boolean);
          for (const line of lines) {
            const data = JSON.parse(line);
            view.webview.postMessage({
              type: 'token',
              content: data.message?.content ?? '',
              done: data.done,
            });
          }
        }
      }

      // Send selected editor code as context
      if (msg.type === 'getContext') {
        const editor = vscode.window.activeTextEditor;
        const code = editor?.document.getText(editor.selection) 
                  || editor?.document.getText() 
                  || '';
        view.webview.postMessage({ type: 'context', code });
      }
    });
  }
}

function getWebviewHTML(): string {
  return /* html */`<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 8px; }
    #messages { height: 70vh; overflow-y: auto; margin-bottom: 8px; }
    .msg { margin: 8px 0; padding: 6px; border-radius: 4px; }
    .user { background: var(--vscode-inputOption-activeBackground); }
    .assistant { background: var(--vscode-editor-inactiveSelectionBackground); }
    textarea { width: 100%; box-sizing: border-box; }
    button { width: 100%; margin-top: 4px; }
  </style>
</head>
<body>
  <div id="messages"></div>
  <textarea id="input" rows="3" placeholder="Ask Gemma..."></textarea>
  <button onclick="sendMessage()">Send</button>
  <button onclick="addCodeContext()">+ Add Editor Code</button>

  <script>
    const vscode = acquireVsCodeApi();
    let history = [];
    let currentAssistantDiv = null;

    function addCodeContext() {
      vscode.postMessage({ type: 'getContext' });
    }

    function sendMessage() {
      const input = document.getElementById('input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';

      history.push({ role: 'user', content: text });
      appendMessage('user', text);

      currentAssistantDiv = appendMessage('assistant', '');
      vscode.postMessage({ type: 'chat', history });
    }

    function appendMessage(role, text) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.textContent = text;
      document.getElementById('messages').appendChild(div);
      div.scrollIntoView();
      return div;
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'token') {
        currentAssistantDiv.textContent += msg.content;
        if (msg.done) history.push({ role: 'assistant', content: currentAssistantDiv.textContent });
      }
      if (msg.type === 'context') {
        document.getElementById('input').value = 
          'Context from editor:\n\`\`\`\n' + msg.code + '\n\`\`\`\n\n';
      }
    });

    document.getElementById('input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  </script>
</body>
</html>`;
}

export function deactivate() {}
