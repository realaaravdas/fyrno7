fyrno7 annotates research papers like a human reader, using a local LLM (LM Studio, Ollama, Gemma...). Nothing leaves your computer. See the README for model setup.

## Downloads

| Platform | File |
|---|---|
| Windows | `fyrno7-windows-x64-setup.exe` (installer), `fyrno7-windows-x64.msi`, or `fyrno7-windows-x64.exe` (portable) |
| macOS | `fyrno7-macos-universal.dmg` (Apple Silicon and Intel) |
| Linux | `fyrno7-linux-x86_64.AppImage` (any distro), `fyrno7-linux-amd64.deb` (Debian/Ubuntu), `fyrno7-linux-x86_64.rpm` (Fedora/openSUSE) |

## First launch

These builds are not code-signed.

- **Windows:** SmartScreen may show "Windows protected your PC". Click *More info → Run anyway*.
- **macOS:** drag fyrno7 to Applications, then right-click it and choose *Open*. If macOS says the app is "damaged", run `xattr -dr com.apple.quarantine /Applications/fyrno7.app` in Terminal.
- **Linux:** for the AppImage, run `chmod +x fyrno7-linux-x86_64.AppImage` then launch it. Needs `webkit2gtk-4.1` (installed automatically by the .deb/.rpm).

The macOS and Linux builds are produced by CI and have not been tested by the maintainer yet. Please report problems in Issues.
