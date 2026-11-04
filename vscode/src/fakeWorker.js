// Stands in for the browser's Worker so Vite bundles each worker and hands
// back its URL; monaco-vscode-api starts the real workers itself.
export class Worker {
  constructor (url, options) {
    this.url = url
    this.options = options
  }
}
