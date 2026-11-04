/* ------------------------------------------------------------------
   git-sandbox-vscode: draws ```git-sandbox-vscode``` exercises in VS Code.

   Registers the `vscode` view with git-sandbox (see registerView in
   sandbox-ui.js). The workbench itself is several megabytes
   (vscode/workbench.js and the files beside it), so nothing is fetched
   until a VS Code exercise scrolls into view.

   VS Code's services are global, so a page has one workbench. It sits in
   the exercise that last asked for it: it follows the reader to the next
   VS Code exercise they scroll to, unless the one it is in is still in
   view, and every other one offers to bring it over.
   ------------------------------------------------------------------ */
(function (root) {
  'use strict';

  var me = document.currentScript;
  // vscode/ sits next to this file, wherever the page put it
  var base = me && me.src ? me.src.replace(/[^\/]*([?#].*)?$/, '') + 'vscode/' : 'vscode/';
  var loading = null;

  function load() {
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
  }

  var exercises = [];   // { pane, binding, visible }
  var owner = null;     // the exercise the workbench is in
  var moving = null;    // the move in progress, a promise

  // what an exercise without the workbench shows: why, and a way to get it
  function placeholder(ex, text, button) {
    ex.pane.innerHTML = '';
    var msg = document.createElement('div');
    msg.className = 'gs-ext-msg';
    msg.setAttribute('role', 'status');
    var p = document.createElement('p');
    p.textContent = text;
    msg.appendChild(p);
    if (button) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gs-hint';
      b.textContent = button;
      b.addEventListener('click', function () { bring(ex); });
      var wrap = document.createElement('p');
      wrap.appendChild(b);
      msg.appendChild(wrap);
    }
    ex.pane.appendChild(msg);
  }

  function elsewhere(ex) {
    placeholder(ex, 'VS Code is open in “' + owner.binding.title + '”, elsewhere on this page.', 'Open VS Code here');
  }

  // move the workbench into `ex` (starting it, the first time)
  function bring(ex) {
    if (ex === owner) return moving || Promise.resolve();
    var from = owner;
    owner = ex;
    // VS Code sizes itself to the pane, so it should arrive to an empty one
    if (from) ex.pane.innerHTML = '';
    else placeholder(ex, 'Starting VS Code…');
    var step = (moving || Promise.resolve())
      .then(load)
      .then(function (vsc) { return vsc.attach(ex.pane, ex.binding); })
      .then(function () {
        // the pane it left keeps a way to bring it back; its own pane loses
        // the message it showed while VS Code started
        if (from && from !== owner) elsewhere(from);
        Array.prototype.slice.call(ex.pane.children).forEach(function (c) {
          if (c.classList.contains('gs-ext-msg')) ex.pane.removeChild(c);
        });
      }, function (e) {
        owner = from;
        placeholder(ex, 'VS Code could not start: ' + (e && e.message ? e.message : e), 'Try again');
      });
    moving = step.then(function () { moving = null; });
    return step;
  }

  var observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          exercises.forEach(function (ex) { if (ex.pane === en.target) ex.visible = en.isIntersecting; });
        });
        // the workbench goes to the first exercise in view, unless the one
        // it is in is in view too
        if (owner && owner.visible) return;
        for (var i = 0; i < exercises.length; i++) {
          if (exercises[i].visible) { bring(exercises[i]); return; }
        }
      }, { threshold: 0.25 })
    : null;

  var view = {
    attach: function (pane, binding) {
      var ex = { pane: pane, binding: binding, visible: false };
      exercises.push(ex);
      if (owner) elsewhere(ex);
      else placeholder(ex, 'VS Code starts when this exercise scrolls into view.', 'Start VS Code');
      if (observer) observer.observe(pane);
    }
  };

  // git-sandbox picks this up whether it loaded before or after us
  (root.__gsViews = root.__gsViews || []).push(['vscode', view]);
})(window);
