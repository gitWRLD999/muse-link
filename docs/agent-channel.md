# Fast agent channel

Use one long-lived `muse-link mcp agent` process, preferably forwarded over one
verified SSH stdio connection. The Windows broker survives client disconnects.
Use browser DOM tools for websites, scoped accessibility for native apps, and
CUA screenshot pixels only when semantic targets are unavailable.

## Regular Chrome

Configure `regular_chrome` as `kind:chrome`, with an explicit `profile` directory.
The local profile's `PLAYWRIGHT_MCP_EXTENSION_TOKEN` can be supplied in `env`.
The `chrome` alias points at the same engine. A Patchright/CDP engine is a
separate profile and must not be the default route to the user's accounts.

Tools: `chrome_status`, `open_url`, `list_tabs`, `select_tab`, `snapshot`, `find`,
`act`, `steps`, `screenshot`. Selection is internal; it never calls
Playwright's `bringToFront`. Tabs are tagged by this connection, and unrelated
human tabs are not adopted. DOM operations resolve a unique target immediately
before acting. `steps` admits up to 12 known operations, stops on first failure,
and returns fresh page state. A completed dispatch is not verification of a
business outcome; check the resulting page state.

When SideScreen is configured, the extension selector opens in a dedicated
window using current monitor bounds. Browser calls use SideScreen's foreground
and keyboard-focus monitor. An application or human focus change reports
`stop:true`; it never restores focus or replays an action. **The upstream
extension activates its window on a fresh connection.** The guard reports that
initial change. Inspect connection status before continuing; don't retry a
mutating action. The persistent connection avoids attaching for every task.
This does not promise zero focus changes during reconnection or arbitrary apps.

## Desktop

`sidescreen_status` probes actual CUA readiness and returns a fresh monitor ID.
`sidescreen_windows` supplies handles only from that display. `sidescreen_observe`
defaults to a tree with at most 256 elements and depth 20, without an image.
Request `include_screenshot:true` when needed; images default to maximum
dimension 1280, and 0 requests native resolution. Coordinates always refer to
the returned capture, not its dimensions in a preview. A capture ID binds pixel
input. Tree-only and image-only observations are supported. Query/output limits
can reduce payload; query filtering does not guarantee a shorter provider walk.

`sidescreen_find` and `sidescreen_wait` use exact label/role selectors.
`sidescreen_act_and_observe` combines one grounded action with its next
observation. `sidescreen_steps` freshly observes and uniquely resolves each
named target; it never reuses a token across steps. Password/read-only native
text checks, process/window identity, geometry, containment, one-use records,
120-second expiry, background-only delivery and the 250 ms focus guard remain.
Unsupported actions have no global input fallback.

The installed helper runs `--server` with newline-delimited JSON over private
stdio. It retains one CUA MCP connection to the session-specific named pipe.
Legacy one-shot helpers use CUA CLI calls so closing an MCP client does not end
an observation's session before its next action. Native UIA properties are
cached within each fresh inspection, never reused as permission to act later.

## Measurement and durability

Every broker response has `_meta.museLink` queue, execution and total timings.
Status retains the last 50 timings, with tool names and no arguments or images.
Browser responses also include a focus receipt when SideScreen is configured.
Configured engines are distinct from their probed health.

Keep the broker in the interactive sign-in task and CUA in its scoped startup
supervisor. Use `%USERPROFILE%\AgentTools` to avoid packaged AppData redirection.
Reboot persistence still requires the Windows user to sign in; locked desktops
and Session 0 cannot supply interactive computer use. No hosted native computer
use backend is patched by this package.

## Verification

`node --test test/*.test.mjs` covers transport, credentials, refusal and fresh
batch targeting. `node test/live-agent.mjs` is opt-in and runs through the same
MCP proxy as Muse. It starts a local disposable webpage, exercises navigation,
DOM actions, cookies across owned tabs, selection and screenshot delivery.
Optional `MUSE_NATIVE_PROBE` and `MUSE_WPF_PROBE` paths add disposable SideScreen
native/WPF targets. Reports and screenshots remain local under the configured
user's `AgentTools/MuseLink/acceptance`; they contain no SSH credentials.

On October 3, 2026 the simulated Muse MCP channel passed 32 live checks with
both disposable desktop targets, regular Chrome Profile 1 and CUA 0.31.0.
Navigation took 1.5 seconds, three browser operations 1.7 seconds, and browser
capture 1.6 seconds in that run. Native/WPF act-and-observe took 0.8–1.0 seconds.
These are local tool times, excluding the remote network and model reasoning.
The separate suites passed 16 Node tests, 5 SSH helper tests, 22 SideScreen
non-UI checks, 61 CUA live checks, 37 native background checks and 12 adapter
checks. The initial extension attachment's focus change was detected separately.
This local simulation does not verify Muse's remote SSH client or guarantee
identical performance and compatibility to ChatGPT's hosted computer-use tools.
