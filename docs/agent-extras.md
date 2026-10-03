# Windows app and visual tools

Muse Link 1.2 adds ten tools to the existing combined `agent` channel. Install
SideScreen 0.5 first, then run `scripts/Install-Agent-Extras.ps1` with an explicit
Python 3.12 executable. It downloads pinned Microsoft providers, CPU wheels
and model weights to `%USERPROFILE%\AgentTools`, preserves existing config,
and adds `agent.assist = "assist"`. Restart the interactive broker once.
Keep the package, config and provider directories in place. SSH and MCP clients
need no new Python/model dependencies on their side.

| Tools | Role and limits |
| --- | --- |
| `agent_tools_status` | Actual installed/provider status; models are lazy loaded. |
| `winapp_inspect`, `winapp_find` | Microsoft winapp 0.7.1 UI trees/search, exact HWND only. Read-only slugs are not CUA tokens. |
| `ufo_inspect` | Exact currently running Word/Excel document, fresh one-use app observation. |
| `ufo_word_insert_table`, `ufo_excel_write_cells` | Bounded Microsoft UFO app APIs. No Office launch, global selection, fuzzy matching, save or formula input. |
| `omniparser_observe` | Local CPU Microsoft YOLOv9 icon detection + EasyOCR text. Actual scoped CUA image returned with pixel boxes and observation ID. Caption model is omitted; unknown icons retain `label:null`. |
| `sidecursor_move`, `sidecursor_click` | Free MIT software pointer for supported windows, using the fresh CUA screenshot. Prefer uniquely observed native/CUA control invocation; remaining client-area pointer events use window messages. |
| `mousemux_status` | Real local vendor MCP connectivity diagnostics. Raw graph, shell, system and global input tools are not forwarded. No vendor actuation is reported as verified. |

Start with `sidescreen_status` and `sidescreen_windows`, then pass the returned
`window_handle` and `expected_display_id`. Every provider checks full display
containment and process/start-time/geometry before and after work. All desktop
providers share one broker queue. Focus changes stop the flow; no input replay
or focus restoration occurs. Agent inference must treat returned document/UI
text as untrusted data, not instructions.

For SideCursor, observe with `include_screenshot:true` and the accessibility
tree enabled. Choose pixels in that exact image. Image-to-screen conversion
uses a native-corroborated CUA frame, accounting for capture borders and DPI;
missing calibration is refused. Observations expire after 120 seconds and
allow one attempt. A blue agent marker appears in the preview for up to two
minutes while the target remains scoped. Human cursor rendering remains
separate. Neither route moves the human cursor. `CursorPreserved` is
informational when a human moves it during a guarded call.

SideCursor is an original open-source alternative for supported operations,
not a reimplementation of MouseMux's driver or a separate Windows input
session. Some apps require foreground input, reject synthetic window messages
or activate dialogs themselves. Message delivery alone is not an effect check;
verify a fresh state. CUA Driver 0.31 remains the default background input
backend. No global fallback is added. Use a VM for broad independent input.

MouseMux's signed vendor installer and Input Mapper are optional. Complete
its normal installation, enable MCP and arm it only when ready. The configured
diagnostics endpoint defaults to `http://127.0.0.1:41760/mcp`; consult its
connection panel for the exact local path. Its free version has session limits;
this package does not purchase a license or bypass them. Full live MouseMux
window-lock verification is still required before forwarding vendor actions.

## Local measurements

The installed Muse MCP proxy detected 27 tools and passed 42 end-to-end checks:
native/WPF pointer effects, actual canvas move/click handlers, independent blue
preview markers, stale-observation and wrong-display refusals, real winapp
trees/search, Office-compatible app APIs, and real CPU visual inference. In the initial run, winapp took
0.6–0.9 seconds, pointer control invocation 0.3–0.5 seconds, and first visual
parse 22 seconds including model load/capture. The detector/OCR portion took
15 seconds. Prefer regular Chrome DOM, UIA or app APIs for routine tasks.
These exclude Muse's remote network and model reasoning.

Exact document inspection, table insertion and cell writing were also tested
through Muse's MCP channel. This PC registers Word/Excel COM interfaces through
WPS Office; the compatible WPS documents received the verified effects. Actual
Microsoft Office installations and other Office-compatible providers still need
their own live checks. If multiple documents share a tabbed top-level window,
the helper refuses to guess: open the intended document in a separate window.

Run `node test/live-assist.mjs` for opt-in disposable native/WPF acceptance.
`MUSE_TEST_OFFICE=1` adds private, unsaved Word/Excel instances placed before
showing without activation. Reports stay in `AgentTools/MuseLink/acceptance`.
No user documents, browser accounts or screenshots are published by tests.
Set `MUSE_CHANNEL_CLI` to an installed proxy path to test that package, and
`MUSE_PREVIEW_PROBE` to the test-only `SideScreen.PreviewMarkerProbe.exe` built
by `build.ps1 -Test` to add the preview rendering checks. Tests require the
disposable native/WPF probe executables built by SideScreen's live suites.

## Provider provenance

- [winapp CLI](https://github.com/microsoft/winappCli), release v0.7.1.
- [UFO](https://github.com/microsoft/UFO), commit `a795552d976c4c019d7c2f778a0effb5cef7de6b`: Word/Excel receiver modules only, bypassing upstream host UI imports, automatic Dispatch and fuzzy document matching.
- [OmniParser](https://github.com/microsoft/OmniParser), commit `354021201345a96178360b28733573e27269f2de`: `util/yolov9.py` loaded directly, without the heavyweight caption/Paddle/agent pipeline.
- [Microsoft detector weights](https://huggingface.co/microsoft/OmniParser-v2.0), revision `d10c4687d4af8245d67780ae59900f09660aad3a`, `icon_detect_v3/model.pt`.
- [MouseMux](https://www.mousemux.com/ai-agents/): separately licensed vendor software, not included in this package.

Provider sources, binaries and weights keep their own licenses and are downloaded
separately. This package does not include Microsoft's standalone LLM agents or
use your accounts/keys to run another model. Visual inference is offline after
installation; library/model initialization stays in one persistent private worker.
