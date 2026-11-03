--[[--------------------------------------------------------------------
  git-sandbox-vscode.lua — the VS Code view for git-sandbox exercises.

    ```git-sandbox-vscode
    title: Commit from VS Code
    tasks:
      - text: Make a commit
        when: commits >= 1
    ```

  takes every option a ```git-sandbox``` block does. The git-sandbox
  filter turns it into an exercise, as it does any ```git-sandbox-<view>```
  block; this filter only adds the files that draw VS Code in it. It finds
  those exercises before git-sandbox has run (the code block) or after
  (the div it became), so the two filters can be listed in either order.
----------------------------------------------------------------------]]

local script_dir = pandoc.path.directory(PANDOC_SCRIPT_FILE)
local function res(f) return pandoc.path.join({ script_dir, 'resources', f }) end

local function warn(msg)
  io.stderr:write('[git-sandbox-vscode] ' .. msg .. '\n')
end

-- every file under dir, named by its path below `prefix`
local function list_files(dir, prefix, out)
  for _, name in ipairs(pandoc.system.list_directory(dir)) do
    local full = pandoc.path.join({ dir, name })
    local rel = prefix .. '/' .. name
    -- only folders can be listed
    if pcall(pandoc.system.list_directory, full) then
      list_files(full, rel, out)
    else
      out[#out + 1] = { name = rel, path = full }
    end
  end
  return out
end

-- The workbench is several megabytes. It is copied next to pages that have
-- a VS Code exercise, and fetched only once one scrolls into view.
local added = false
local function add_dependency()
  if added or not quarto.doc.isFormat('html:js') then return end
  added = true
  local ok, files = pcall(list_files, res('vscode'), 'vscode', {})
  if not ok or #files == 0 then
    warn('the workbench is missing from resources/vscode/; build it with ' ..
         '`cd vscode && npm install && npm run build`')
    files = {}
  end
  quarto.doc.addHtmlDependency({
    name = 'git-sandbox-vscode',
    version = '1.1.0',
    scripts = { { path = res('sandbox-vscode.js'), afterBody = true } },
    resources = files
  })
end

function CodeBlock(el)
  if el.classes:includes('git-sandbox-vscode') then add_dependency() end
  return nil
end

function RawBlock(el)
  if el.format == 'html' and el.text:find('git-sandbox-view-vscode', 1, true) then add_dependency() end
  return nil
end
