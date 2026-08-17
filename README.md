# KeY for VS Code

Verify Java methods with the [KeY](https://key-project.org) theorem prover from VS Code and
VS Codium. Select a method in the editor or a row in the KeY view and ask for it to be
verified: KeY proves in the background, the proofs are written to the project, and the views
show what the project can be asked to prove and how far each obligation has got.

The extension talks to [key-ide-common](https://github.com/unp1/key-ide-common), which is the
process that drives KeY. Nothing of KeY is linked or bundled here: even the status icons are
fetched from the KeY the user configured.

It offers the same work as the
[IntelliJ plugin](https://github.com/unp1/key-intellij-plugin), in the shapes VS Code has for
it, so one manual describes both.

## What it does

- **KeY view** in the activity bar with *Proof Obligations* by context, class and method,
  and *Dependencies* with what a proof rests on; *Verification*, a sortable table of where
  every obligation stands and what each attempt cost, in the bottom panel, where a table has
  the width it wants.
- **Verify, replay, remove** a proof from a row or from the editor's context menu, with a
  progress notification that can be stopped.
- **Gutter marks**: a check where every obligation of a method is proved, a check in brackets
  where one rests on a lemma that is not, a cross where one is open, and KeY's continue
  button where KeY has judged none of them.
- **Verify on save**: saving a source replays that context's proofs and proves what the edit
  left unproved, including the contracts a proof rests on.
- **Proof options** at project, context and obligation level, edited in a form that shows
  each option with KeY's own label and explanation, what the level states and what it would
  inherit; the limits are the rule applications and KeY's timeout, where `-1` is none.
- **The prover**, single core or a number of workers, on the KeY toolbar and in the status
  bar.
- **Open a proof in a KeY window** to look at it, and **go to the source** a contract is
  written on.
- **Contexts**, the paths KeY reads, edited through pickers or by hand in
  `.key/settings.json`.

## Documentation

A getting-started guide, a walk from an empty project to a closed proof, and what every view,
mark and icon means:

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

To try it, open this directory in VS Code and press F5, which starts an Extension
Development Host with the extension loaded.

The wire between this extension and KeY can be exercised without an editor, which is what
the smoke test is for:

```
npm run smoke -- verify <key-jar> <key-ide-common-jar> <project-root>
```

It lists a context, proves and replays an obligation, and asks what a proof rests on and
what a context offers to choose from.

## Installing it locally

Not on the marketplace. Package the extension and install the file:

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

Then set, in the settings:

- **key.keyJar**: a `key-*-exe.jar` from a KeY build or release
- **key.bridgeJar**: the `key-ide-common-*-all.jar` built from
  [key-ide-common](https://github.com/unp1/key-ide-common)
- **key.javaHome**: a JDK 21, unless `JAVA_HOME` already names one

The rest have working defaults: `key.keyHome` keeps KeY's own files in the project,
`key.verifyOnSave` is on, `key.trashPolicy` keeps every replaced proof, and `key.transport`
picks the connection that works on the platform.

The project's contexts, which say what KeY reads, are kept in `.key/settings.json` and are
meant to be committed with the project. Use **KeY: Edit Contexts** to write one, and
**KeY: Validate Configuration** to have the paths checked before KeY is started.

## Commands

- **Verify with KeY** — prove the obligations of the method at the cursor
- **KeY: Verify Everything**, **KeY: Replay Every Saved Proof**, **KeY: Refresh**
- **KeY: Proof Options of the Project**, **KeY: Choose the Prover**
- **KeY: Empty the Trash of Replaced Proofs**
- **KeY: Clean Up Settings of Proof Obligations That No Longer Exist**
- **KeY: Edit Contexts**, **KeY: Validate Configuration**, **KeY: Open Configuration File**
- **KeY: Restart KeY**, **KeY: Stop**

## Platforms

Linux, macOS and Windows. On Linux and macOS the extension reaches KeY over a Unix domain
socket; on Windows it asks for a loopback port instead, since Node reaches a local socket
there only as a named pipe. `key.transport` forces the port everywhere if a runtime needs it.

## Licence

MIT, in [LICENSE](LICENSE). The extension exchanges plain data with key-ide-common and links
nothing of KeY, which is what lets it be licensed this liberally; key-ide-common, which does
link KeY, is GPL-2.0-only.
