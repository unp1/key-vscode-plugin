# Installing

The extension is not on the marketplace. Build it and install it from a file. KeY is not
included; you provide it.

## 1. Get KeY

Download a release from [key-project.org](https://key-project.org), or build KeY:

```
git clone https://github.com/KeYProject/key.git
cd key
./gradlew :key.ui:shadowJar
```

The result is `key.ui/build/libs/key-*-exe.jar`.

## 2. Build the bridge

The bridge is the process that runs KeY for the extension. It is compiled against KeY's API
and needs the KeY checkout in a sibling directory named `key`:

```
cd ..
git clone git@github.com:unp1/key-ide-common.git
cd key-ide-common
./gradlew shadowJar
```

The result is `build/libs/key-ide-common-*-all.jar`. Building both projects requires a JDK
21 or later.

## 3. Build the extension

```
git clone git@github.com:unp1/key-vscode-plugin.git
cd key-vscode-plugin
npm install
npm run compile
npx @vscode/vsce package
```

The result is `key-ide-*.vsix`.

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

## 5. Configure KeY

In the settings (**Preferences: Open Settings**, then search for KeY):

- **key.keyJar**: the `key-*-exe.jar` from step 1
- **key.bridgeJar**: the `key-ide-common-*-all.jar` from step 2
- **key.javaHome**: a JDK 21 or later, unless `JAVA_HOME` points to one

The other settings have working defaults, see [Settings](settings.md).

Continue with [A first project](first-project.md).

## Rebuilding later

The extension refers to the jars by their path, so a rebuilt jar at the same path is used
without changing the settings. A running bridge keeps the classes it has loaded: after
replacing a jar, run **KeY: Restart KeY**, or reload the window.

## Trying it without installing

Open the extension's directory in VS Code and press **F5**. This starts an Extension
Development Host window with the extension loaded.
