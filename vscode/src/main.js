// The VS Code view: the real VS Code workbench (monaco-vscode-api), cut down
// to what working with git needs: the explorer, editors and diffs, search,
// Source Control, and the integrated terminal. No extensions, no
// marketplace, no debugger. sandbox-vscode.js loads this module when a
// learner first opens a VS Code tab; it sets window.GitSandboxVSCode.
import { initialize, getService, IWorkbenchLayoutService, ICommandService } from '@codingame/monaco-vscode-api'
import getWorkbenchServiceOverride from '@codingame/monaco-vscode-workbench-service-override'
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override'
import { initUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override/common'
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getNotificationsServiceOverride from '@codingame/monaco-vscode-notifications-service-override'
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override'
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override'
import getScmServiceOverride from '@codingame/monaco-vscode-scm-service-override'
import getTerminalServiceOverride from '@codingame/monaco-vscode-terminal-service-override'
import getOutputServiceOverride from '@codingame/monaco-vscode-output-service-override'
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override'
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override'
import getStatusBarServiceOverride from '@codingame/monaco-vscode-view-status-bar-service-override'
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override'
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override'
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override'
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override'
import { registerFileSystemOverlay } from '@codingame/monaco-vscode-files-service-override'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import 'vscode/localExtensionHost'
// themes, file icons, and grammars for the files lessons tend to hold
import '@codingame/monaco-vscode-theme-defaults-default-extension'
import '@codingame/monaco-vscode-theme-seti-default-extension'
import '@codingame/monaco-vscode-git-base-default-extension'
import '@codingame/monaco-vscode-markdown-basics-default-extension'
import '@codingame/monaco-vscode-python-default-extension'
import '@codingame/monaco-vscode-r-default-extension'
import '@codingame/monaco-vscode-javascript-default-extension'
import '@codingame/monaco-vscode-typescript-basics-default-extension'
import '@codingame/monaco-vscode-json-default-extension'
import '@codingame/monaco-vscode-yaml-default-extension'
import '@codingame/monaco-vscode-shellscript-default-extension'
import '@codingame/monaco-vscode-html-default-extension'
import '@codingame/monaco-vscode-css-default-extension'
import { Worker } from './fakeWorker.js'
import { bind } from './session.js'
import { SandboxFileSystem } from './files.js'
import { SandboxTerminalBackend } from './terminal.js'
import { startGit } from './git.js'

const workers = {
  editorWorkerService: new Worker(new URL('@codingame/monaco-vscode-api/workers/editor.worker', import.meta.url), { type: 'module' }),
  TextMateWorker: new Worker(new URL('@codingame/monaco-vscode-textmate-service-override/worker', import.meta.url), { type: 'module' }),
  OutputLinkDetectionWorker: new Worker(new URL('@codingame/monaco-vscode-output-service-override/worker', import.meta.url), { type: 'module' }),
  LocalFileSearchWorker: new Worker(new URL('@codingame/monaco-vscode-search-service-override/worker', import.meta.url), { type: 'module' })
}
window.MonacoEnvironment = {
  getWorkerUrl: (_id, label) => workers[label] && workers[label].url.toString(),
  getWorkerOptions: (_id, label) => workers[label] && workers[label].options
}

const settings = {
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.layoutControl.enabled': false,
  'workbench.activity.showAccounts': false,
  'window.commandCenter': false,
  'files.autoSave': 'off',
  'files.exclude': { '**/.git': true },
  'editor.minimap.enabled': false,
  'editor.fontSize': 13,
  'terminal.integrated.fontSize': 13,
  'terminal.integrated.tabs.enabled': false,
  'terminal.integrated.shellIntegration.enabled': false,
  'terminal.integrated.enablePersistentSessions': false,
  'scm.defaultViewMode': 'list',
  'chat.disableAIFeatures': true,
  'git.enabled': true
}

// the element the workbench draws in, inside a shadow root of its own so
// the page's styles and VS Code's never meet
let frame = null
let ready = null

async function start (container, binding) {
  frame = document.createElement('div')
  frame.style.cssText = 'height:100%;width:100%'
  const el = document.createElement('div')
  el.style.cssText = 'height:100%;width:100%'
  frame.attachShadow({ mode: 'open' }).appendChild(el)
  container.appendChild(frame)
  bind(binding)
  const files = new SandboxFileSystem('/' + binding.name)
  registerFileSystemOverlay(1, files)
  await initUserConfiguration(JSON.stringify(settings))
  await initialize({
    ...getLogServiceOverride(),
    ...getModelServiceOverride(),
    ...getNotificationsServiceOverride(),
    ...getDialogsServiceOverride(),
    ...getConfigurationServiceOverride(),
    ...getTextmateServiceOverride(),
    ...getThemeServiceOverride(),
    ...getLanguagesServiceOverride(),
    ...getStatusBarServiceOverride(),
    ...getOutputServiceOverride(),
    ...getTerminalServiceOverride(new SandboxTerminalBackend()),
    ...getLifecycleServiceOverride(),
    ...getWorkingCopyServiceOverride(),
    ...getStorageServiceOverride({
      fallbackOverride: {
        'workbench.activity.showAccounts': false,
        'workbench.statusbar.hidden': JSON.stringify(['status.workbench.keyboardLayout'])
      }
    }),
    ...getScmServiceOverride(),
    ...getSearchServiceOverride(),
    ...getExplorerServiceOverride(),
    ...getWorkbenchServiceOverride(),
    // after the workbench's own, which makes every key on the page VS
    // Code's: only keys pressed inside it are (focus inside a shadow root
    // shows as focus on its host)
    ...getKeybindingsServiceOverride({ shouldUseGlobalKeybindings: () => frame.contains(document.activeElement) }),
    ...getQuickAccessServiceOverride({ isKeybindingConfigurationVisible: () => true, shouldUseGlobalPicker: () => true })
  }, el, {
    workspaceProvider: {
      trusted: true,
      workspace: { folderUri: files.rootUri },
      open: async () => false
    },
    productConfiguration: { nameShort: 'VS Code', nameLong: 'VS Code (git sandbox)' }
  }, {
    userHome: URI.file('/')
  })
  files.scan()
  await startGit(files)
  // open on the explorer with a terminal below, as a project usually starts
  const commands = await getService(ICommandService)
  await commands.executeCommand('workbench.action.terminal.new').catch(() => {})
  await commands.executeCommand('workbench.view.explorer').catch(() => {})
  const layout = await getService(IWorkbenchLayoutService)
  // the pane changes size with the page, and when it fills the window
  new ResizeObserver(() => layout.layout()).observe(frame)
  return layout
}

// Shows the workbench in `container`, working on `binding`'s box. The
// first call starts VS Code; later ones move it, and rebind it if the box
// is a different one.
async function attach (container, binding) {
  if (!ready) {
    ready = start(container, binding)
    ready.catch(() => { ready = null })
    await ready
    return
  }
  const layout = await ready
  if (frame.parentNode !== container) container.appendChild(frame)
  bind(binding)
  layout.layout()
}

window.GitSandboxVSCode = { attach }
