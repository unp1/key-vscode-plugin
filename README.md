# KeY for VS Code

Verify Java methods with the [KeY](https://key-project.org) theorem prover in VS Code and
VSCodium. The proofs run in the background and are saved in the project. The KeY views list
the project's proof obligations and their status.

The extension communicates over JSON-RPC with
[key-ide-common](https://github.com/unp1/key-ide-common), a separate process that runs KeY.
The extension neither links nor bundles KeY. Even the status icons are loaded from the
configured KeY jar.

It provides the same functions as the
[IntelliJ plugin](https://github.com/unp1/key-intellij-plugin), using VS Code's views and
commands.

## Features

- **KeY view** in the activity bar: *Proof Obligations*, grouped by context, class and method,
  and *Dependencies*, the contracts a proof uses. The *Verification* table in the bottom
  panel shows the status, time, nodes and branches of every obligation, grouped by class and
  sortable.
- **Verify, replay and remove** proofs from a row or from the editor's context menu. A
  progress notification shows the run and can cancel it.
- **Code lenses** above each method with a contract: **Verify with KeY**, **Replay** and
  **Open proof**. `key.codeLens` turns them off.
- **Gutter marks**: a check mark when every obligation of a method is proved, a check mark in
  brackets when a proof depends on an unproved lemma, a cross when an obligation is open, and
  KeY's continue icon when no obligation has a result yet.
- **Verify on save**: saving a file replays the saved proofs of its context and proves the
  obligations the edit broke or added, as well as unproved contracts that closed proofs
  depend on.
- **Proof options** at project, context and obligation level, edited in a form that shows
  each option with KeY's label and description, the value set at this level and the
  inherited value. The limits are the maximum number of rule applications and KeY's timeout;
  `-1` means no limit.
- **Prover**: single-threaded or with several worker threads, selectable in the KeY toolbar
  and in the status bar.
- **Open a proof** in KeY's window, and **go to the source** of a contract.
- **Contexts**, the paths KeY loads, edited in a form or directly in `.key/settings.json`.

## Documentation

The documentation covers installation, a first project from setup to a closed proof, and the
meaning of every view, mark and icon. It is published at
<https://unp1.github.io/key-vscode-plugin/>. To view it locally:

```
pip install mkdocs mkdocs-material
mkdocs serve
```

The pages are in `docs/`.

## Building

Requires Node 20 or later.

```
npm install
npm run compile
```

To try it, open this directory in VS Code and press F5. This starts an Extension Development
Host with the extension loaded.

The smoke test checks the connection to KeY without an editor:

```
npm run smoke -- verify <key-jar> <key-ide-common-jar> <project-root>
```

It lists a context, proves and replays an obligation, and requests the dependencies of a
proof and the options of a context.

## Installing it locally

The extension is not on the marketplace. Package it and install the resulting file:

```
npx @vscode/vsce package
```

In the Extensions view: **…** → **Install from VSIX…**, and pick the file.

Or from a terminal, with `code` or `codium`:

```
code --install-extension key-ide-0.1.0.vsix
```

On macOS the command is not on the path. Add it with **Shell Command: Install 'code' command
in PATH** from the command palette, or use the full path:

```
/Applications/VSCodium.app/Contents/Resources/app/bin/codium --install-extension key-ide-0.1.0.vsix
```

```
/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code --install-extension key-ide-0.1.0.vsix
```

Then set:

- **key.keyJar**: a `key-*-exe.jar` from a KeY build or release
- **key.bridgeJar**: the `key-ide-common-*-all.jar` built from
  [key-ide-common](https://github.com/unp1/key-ide-common)
- **key.javaHome**: a JDK 21 or later, unless `JAVA_HOME` points to one

The other settings have working defaults: `key.keyHome` stores KeY's settings, logs and
caches in the project, `key.verifyOnSave` is on, `key.trashPolicy` keeps every replaced
proof, and `key.transport` selects the connection type for the platform.

The project's contexts, the paths KeY loads, are stored in `.key/settings.json`. Commit this
file with the project. **KeY: Edit Contexts** creates or edits a context, and **KeY: Validate
Configuration** checks the paths before KeY starts.

## Commands

- **Verify with KeY**: proves the obligations of the method at the cursor
- **KeY: Verify Everything**, **KeY: Replay Every Saved Proof**, **KeY: Refresh**
- **KeY: Proof Options of the Project**, **KeY: Select Single Core or Multi-Core Prover**
- **KeY: Empty the Trash of Replaced Proofs**
- **KeY: Clean Up Settings of Proof Obligations That No Longer Exist**
- **KeY: Edit Contexts**, **KeY: Validate Configuration**, **KeY: Open Configuration File**
- **KeY: Restart KeY**, **KeY: Stop**

## Platforms

Linux, macOS and Windows. On Linux and macOS the extension connects to the bridge over a Unix
domain socket. On Windows it uses a loopback TCP port. Set `key.transport` to `tcp` to use
TCP on every platform.

## Licence

MIT, see [LICENSE](LICENSE). The extension communicates with key-ide-common over JSON-RPC
and does not link KeY. key-ide-common links KeY and is licensed under GPL-2.0-or-later.
