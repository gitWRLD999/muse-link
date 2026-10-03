# Regular Chrome account access

Use the combined `agent` MCP channel and its live tool schemas. Start with
`chrome_ready`, then `open_url`, `snapshot`, and semantic `act` or `steps`.
`chrome_status` reports readiness, current SideScreen bounds, the configured
profile, a comparison against that profile's extension token, and limited local
Chrome metadata. Tokens, cookies, passwords and account identifiers are not
returned by that diagnostic. Chrome account metadata is separate from a site's
actual sign-in state.

One profile can contain several Google accounts. Do not assume the first
Google account is the identity requested for a task. Verify the requested
identity or let the human choose it during sign-in; changing monitors or
launching another automation profile does not choose the correct account.

A Chrome profile is shared across windows and monitors. The user's existing
main-display window can stay where it is while the bridge uses a dedicated
SideScreen window with the same profile and cookie store. Do not ask the user
to drag their main Chrome window. Do not substitute Patchright, a test browser,
a copied profile, or a different Chrome profile for their accounts.

Pin `regular_chrome.profile` to the directory name from `chrome://version`,
such as `Profile 1`. Install the Playwright extension in that profile and keep
its matching `PLAYWRIGHT_MCP_EXTENSION_TOKEN` in the local protected config.
Profile-specific tokens and existing-session behavior are documented by
[Microsoft](https://github.com/microsoft/playwright/blob/main/packages/extension/README.md).

If the agent tab is closed or the display layout changes, read `chrome_status`
and call `chrome_ready`. Recovery creates a new owned tab or places the verified
agent group on the current SideScreen. If the group shares a window with human
tabs, only the owned group moves into an inactive window. An unowned tab inside
the group prevents movement. `list_tabs`, `select_tab` and `close_tab` operate
only on bridge-owned tabs. Popups are adopted only when their opener is owned.
The bridge is shared by clients of the same configured browser engine; these
browser tabs are not per-client security boundaries.

Cold extension attachment can activate Chrome. The focus guard stops after
that preparation before a requested webpage navigation or form action begins.
Inspect `chrome_status` before continuing after `stop:true`; do not replay an
unknown mutating action or restore foreground focus. Subsequent operations use
the persistent connection. This does not promise focus-free cold attachment.

For the small Chrome account chooser/FedCM bubble, use the whole-window
`chrome_desktop_observe` and background `chrome_desktop_act` route. It is native
browser UI, so absence from a webpage snapshot does not mean Chrome is signed
out or on the wrong monitor. See [desktop input](chrome-desktop.md).

Google password, MFA, passkey, OAuth-consent and security-block pages are
authentication states, not evidence that the profile is on the wrong monitor.
Read the actual state and ask for human completion in the same profile when
needed. Never bypass a Google security block or claim another automation
profile fixes sign-in. After human completion, take a fresh snapshot and verify
the application's authenticated page before resuming an authorized workflow.

Verification for 1.3.1: 35 Node and five SSH tests passed, including seven
Chrome recovery/regression checks. The installed MCP proxy passed 32 live
browser/native/WPF checks and five additional discovery/profile/recovery
checks. A read-only Google account dashboard confirmed an existing signed-in
session. Site login completion and OAuth consent were not automated. Cold
attachment focus changes were detected separately. Tests of group relocation
and preserving unrelated tabs use a browser-effect model; arbitrary Chrome
window arrangements have not all been certified.

Old OpenClaw `chrome-tools.json` catalogs containing raw `browser_tabs` and
32 Playwright tools describe the original adapter. The current route uses
`list_tabs`, `open_url`, `select_tab`, and the schemas returned by `agent list`.
