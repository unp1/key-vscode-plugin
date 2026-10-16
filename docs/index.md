# KeY for VS Code

Prove that your Java methods do what their JML contracts say, without leaving the editor.
Put the cursor in a method, ask for it to be verified, and [KeY](https://key-project.org)
proves in the background. The proofs are written into the project, and the KeY view shows
what the project can be asked to prove and how far each obligation has got.

Works in VS Code and in VS Codium. The extension does not contain KeY: it starts the KeY you
point it at, drives it without a window, and reads what it says.

The source, the issue tracker and the releases are on GitHub:
**[github.com/unp1/key-vscode-plugin](https://github.com/unp1/key-vscode-plugin)**.

## What you need

| | |
|---|---|
| VS Code or VS Codium | 1.85 or later |
| A KeY distribution | a `key-*-exe.jar`, built or downloaded |
| The shared KeY component | a `key-ide-common-*-all.jar`, built from [key-ide-common](https://github.com/unp1/key-ide-common) |
| A JDK 21 | to run them, named by `JAVA_HOME` or by a setting |
| A Java project with JML | contracts written as `/*@ ... @*/` comments above the methods |

No Java language server is needed. The cursor position travels to KeY, which resolves it
against its own view of the sources.

## Where to go next

- [Installing](install.md) — the two jars, the extension from a file, and where to point it
- [A first project](first-project.md) — from an empty project to a closed proof
- [The interface](interface.md) — what every view, mark and icon means
- [Settings](settings.md) — every setting and what it decides

The [IntelliJ plugin](https://github.com/unp1/key-intellij-plugin) does the same work with
the same words, so what you learn here carries over.
