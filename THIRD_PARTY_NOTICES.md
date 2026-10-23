# Third-party notices

This extension bundles third-party software in
`_extensions/git-sandbox/resources/isomorphic-git.bundle.js`:

- [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git) (MIT)
- [buffer](https://github.com/feross/buffer) (MIT)

The optional VS Code view, `_extensions/git-sandbox/resources/vscode/`, is
built from:

- [Visual Studio Code](https://github.com/microsoft/vscode) (MIT), through
  [monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api) (MIT),
  including VS Code's built-in themes, file icons and language grammars
- [xterm.js](https://github.com/xtermjs/xterm.js) (MIT)
- [vscode-oniguruma](https://github.com/microsoft/vscode-oniguruma) and
  [vscode-textmate](https://github.com/microsoft/vscode-textmate) (MIT)
- [DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 or MPL-2.0),
  [marked](https://github.com/markedjs/marked) (MIT),
  [KaTeX](https://github.com/KaTeX/KaTeX) (MIT),
  [opentype.js](https://github.com/opentypejs/opentype.js) (MIT),
  [@vscode/diff](https://www.npmjs.com/package/@vscode/diff) (MIT),
  [jschardet](https://github.com/aadsm/jschardet) (LGPL-2.1+) and
  [iconv-lite](https://github.com/ashtuchkin/iconv-lite) (MIT)

Their full licence texts are in the packages under `vscode/node_modules/`
after `npm install`. jschardet is LGPL: it is bundled unmodified, and
`vscode/` holds everything needed to rebuild the bundle with another
version of it.
