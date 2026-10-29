import { codeSnippets, type Snippet } from './code-export';

export interface CodeDialogOptions {
  /** The current edit document (read on every open); throws when the edit cannot be one. */
  document(): unknown;
  copy(text: string): Promise<void>;
}

export interface CodeDialog {
  open(): void;
  close(): void;
}

/**
 * "Copy as code": the current edit as an edit document and as the few lines that render it in the
 * browser, on a Konva.Image or in Node, one tab each, with the install line and a Copy button.
 */
export function createCodeDialog({ document: getDocument, copy }: CodeDialogOptions): CodeDialog {
  const dialog = Object.assign(document.createElement('dialog'), { className: 'code-dialog' });
  dialog.setAttribute('aria-label', 'Copy as code');
  document.body.append(dialog);
  let selected: Snippet['id'] = 'web';

  const render = () => {
    let snippets: Snippet[];
    try {
      snippets = codeSnippets(getDocument());
    } catch (e) {
      dialog.replaceChildren(Object.assign(document.createElement('p'), { textContent: `This edit cannot be shown as code: ${(e as Error).message}` }), closeButton());
      return;
    }
    const tabs = Object.assign(document.createElement('div'), { className: 'code-tabs' });
    tabs.setAttribute('role', 'tablist');
    const install = Object.assign(document.createElement('p'), { className: 'code-install' });
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    pre.append(code);
    const show = (id: Snippet['id']) => {
      selected = id;
      const s = snippets.find((x) => x.id === id)!;
      for (const t of tabs.children) t.setAttribute('aria-selected', String((t as HTMLElement).dataset.id === id));
      install.textContent = s.install;
      install.hidden = !s.install;
      code.textContent = s.code;
    };
    // Browser first: the snippet most visitors want. The document stays one click away.
    for (const s of [...snippets.slice(1), snippets[0]!]) {
      const t = Object.assign(document.createElement('button'), { type: 'button', textContent: s.label });
      t.setAttribute('role', 'tab');
      t.dataset.id = s.id;
      t.addEventListener('click', () => show(s.id));
      tabs.append(t);
    }
    const copyButton = Object.assign(document.createElement('button'), { type: 'button', className: 'code-copy', textContent: 'Copy' });
    copyButton.addEventListener('click', () => {
      void copy(code.textContent ?? '').then(() => {
        copyButton.textContent = 'Copied';
        setTimeout(() => (copyButton.textContent = 'Copy'), 1500);
      });
    });
    const actions = Object.assign(document.createElement('div'), { className: 'code-actions' });
    actions.append(copyButton, closeButton());
    dialog.replaceChildren(tabs, install, pre, actions);
    show(selected);
  };

  const closeButton = () => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Close' });
    b.addEventListener('click', () => dialog.close());
    return b;
  };

  return {
    open() {
      render();
      if (!dialog.open) dialog.showModal();
    },
    close: () => dialog.close(),
  };
}
