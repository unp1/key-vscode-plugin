# KeY for VS Code

Verify that Java methods satisfy their JML contracts with the
[KeY](https://key-project.org) theorem prover in VS Code and VSCodium. The proofs run in the
background and are saved in the project. The KeY view lists the project's proof obligations
and their status.

The extension does not contain KeY. It runs the KeY installation you configure, without
KeY's user interface, through a separate process, the bridge.

The source, the issue tracker and the releases are on GitHub:
**[github.com/unp1/key-vscode-plugin](https://github.com/unp1/key-vscode-plugin)**.

## Requirements

| | |
|---|---|
| VS Code or VSCodium | 1.85 or later |
| KeY | a `key-*-exe.jar`, built or downloaded |
| The bridge | a `key-ide-common-*-all.jar`, built from [key-ide-common](https://github.com/unp1/key-ide-common) |
| A JDK 21 or later | to run KeY and the bridge, set by `JAVA_HOME` or `key.javaHome` |
| A Java project with JML | contracts written as `/*@ ... @*/` comments above the methods |

No Java language server is needed. The extension sends the cursor position to the bridge,
which finds the method in the sources KeY has loaded.

## Contents

- [Installing](install.md): building the jars and the extension, installing and
  configuring it
- [A first project](first-project.md): from a JML contract to a closed proof
- [The interface](interface.md): the views, commands, marks and icons
- [Settings](settings.md): all settings

The [IntelliJ plugin](https://github.com/unp1/key-intellij-plugin) provides the same
functions under the same names.
