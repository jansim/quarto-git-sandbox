/* ------------------------------------------------------------------
   git sandbox: loader for the optional VS Code view.
   The workbench itself is several megabytes (vscode/workbench.js and the
   files beside it), so this small script only says where it is; nothing
   is fetched until a learner opens a box's VS Code tab.
   ------------------------------------------------------------------ */
(function (root) {
  'use strict';

  var me = document.currentScript;
  // vscode/ sits next to this file, wherever the page put it
  var base = me && me.src ? me.src.replace(/[^\/]*([?#].*)?$/, '') + 'vscode/' : 'vscode/';
  var loading = null;

  root.GitSandboxVSCodeLoad = function () {
    if (root.GitSandboxVSCode) return Promise.resolve(root.GitSandboxVSCode);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.type = 'module';
      s.src = (root.GitSandboxVSCodeBase || base) + 'workbench.js';
      // a module that loaded but failed to run still fires load, without
      // having set the global
      s.onload = function () {
        if (root.GitSandboxVSCode) resolve(root.GitSandboxVSCode);
        else { loading = null; reject(new Error('the VS Code bundle loaded but did not start. The browser console says why.')); }
      };
      s.onerror = function () {
        loading = null;
        reject(new Error('could not load ' + s.src + '. VS Code needs the page served over http(s), not opened as a file.'));
      };
      document.head.appendChild(s);
    });
    return loading;
  };
})(window);
