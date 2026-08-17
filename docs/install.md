# Installing

Nothing here goes through a marketplace: the extension is built and installed from a file,
and KeY is supplied by you.

## 1. Get a KeY

Either a release from [key-project.org](https://key-project.org), or a build of your own:

```
git clone https://github.com/KeYProject/key.git
cd key
./gradlew :key.ui:shadowJar
```

The file you want is `key.ui/build/libs/key-*-exe.jar`.

## 2. Build the shared KeY component

This is the process the extension drives. It needs the KeY checkout beside it, because it is
compiled against KeY's API:

```
git clone git@github.com:unp1/key-ide-common.git
cd key-ide-common
./gradlew shadowJar
```

The file you want is `build/libs/key-ide-common-*-all.jar`. Both projects need a JDK 21.

## 3. Build the extension

```
git clone git@github.com:unp1/key-vscode-plugin.git
cd key-vscode-plugin
npm install
npm run compile
npx @vscode/vsce package
```

The file you want is `key-ide-*.vsix`.

## 4. Install it from a file

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

## 5. Point it at KeY

In the settings (**Preferences: Open Settings**, then search for KeY):

- **key.keyJar** — the `key-*-exe.jar` from step 1
- **key.bridgeJar** — the `key-ide-common-*-all.jar` from step 2
- **key.javaHome** — a JDK 21, unless `JAVA_HOME` already names one

The rest have working defaults; [Settings](settings.md) explains them.

You are ready for [a first project](first-project.md).

## Rebuilding later

The extension holds the jars by path, so replacing a jar in place is enough — with one
catch: a running KeY keeps the classes it loaded. After replacing the shared component, run
**KeY: Restart KeY**, or reload the window.

## Trying it without installing

Open the extension's own directory in VS Code and press **F5**. That starts a second window
with the extension loaded, which is the usual way to develop it.
