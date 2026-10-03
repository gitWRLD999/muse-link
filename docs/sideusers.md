# SideUser for Muse and other agents

Muse Link 1.3 with SideScreen 0.6 exposes 34 combined tools: 9 regular Chrome,
8 desktop, 10 assistance and 7 SideUser tools. The original free native adapter
adds per-event cursor/key/capture state, suppresses activation attempts during
scoped events, and supports x64 and x86 applications. MouseMux is optional and
is not needed for these operations.

Use regular Chrome DOM tools for webpages and signed-in accounts. Use SideUser
for app windows that need pointer gestures or keyboard input. Discover the
current display with `sidescreen_status` and fully contained windows with
`sidescreen_windows`. Open a lease:

```json
{"window_handle":123456,"expected_display_id":"<fresh display ID>","label":"Muse"}
```

`sideuser_open` returns a `sessionId`. That session belongs to this persistent
MCP connection; keep the connection open across calls. `sideuser_observe`
takes `session_id` and optional `include_screenshot:true`. Its observation is
valid once, for at most 120 seconds, and cannot be consumed by another session.

Call `sideuser_act` with `session_id`, `observation_id`, `operation` and
`arguments`. Supported operations:

| Operation | Arguments and route |
| --- | --- |
| `invoke` | `element_token`; existing semantic CUA/native invocation |
| `set_value` | `element_token`, `value`; semantic replacement, including supported WPF controls |
| `move` / `click` | fresh capture `x`,`y`; optional `button`, click `count` 1 or 2 |
| `drag` | 2–64 capture `points` (`x`,`y`), optional `button`, `duration_ms` up to 1500; stays in initial client control |
| `scroll` | capture `x`,`y`, signed `delta`, optional `axis` vertical/horizontal |
| `type` | fresh native Edit `element_token`, Unicode `text`; insertion at its current selection |
| `press` | native Edit `element_token`, named `key`, optional `Control`/`Shift` modifiers |
| `paste` | native Edit `element_token`; inserts the session's private clipboard text |

`sideuser_clipboard` gets text, or sets it when `text` is supplied. This never
reads or changes Windows clipboard contents. Ctrl+C/V/X, Alt combinations and
Windows/global shortcuts are refused. Ctrl+A selects the native edit's text;
shortcut support beyond the tested control families requires app validation.
Password and read-only targets are refused.

`sideuser_run` batches up to 12 steps, each with exact `selector` label/role,
`operation` and `arguments`. Every step receives a new grounded token. Supply
a unique `request_id`; repeats are refused even when an earlier attempt failed.
This avoids replaying mutations after a lost response. Macros stop at the first
missing/ambiguous control, dispatch failure or focus change.

`sideuser_status` lists this connection's leases. `sideuser_close` releases one
lease and its virtual input state without closing the app. Leases expire after
five idle minutes. Process or geometry changes invalidate a lease. Reconnects
and broker restarts require fresh sessions and observations; installed code,
browser profile and sign-in startup survive restarts.

The broker assigns a separate caller ID to each proxy process. Window ownership
also applies to legacy SideScreen and assistance tool calls through that broker.
This is cooperative scheduling between trusted agents sharing a Windows user,
not an adversarial security boundary. Input is serialized rather than concurrent
hardware input. The preview displays separately labeled blue cursors.

The adapter uses a scoped GUI-thread hook with per-event user-mode API
virtualization. The target DLL remains loaded until that app exits; close agent
apps before upgrading its DLLs. Outside events, APIs pass through except recent
agent-window activation suppression, which ends on release or after 120 seconds.
Protected/elevated apps, raw/direct input, asynchronous dialogs and custom input
threads can need another backend or a separate VM. Universal app compatibility
is not established. Stop on unknown outcomes and inspect; never restore focus
or automatically replay input.

Any MCP-capable agent can use this API over the existing SSH stdio connection.
OpenAI computer-use integration can map screenshot/click/drag/scroll/type/key
actions to the session API, but built-in ChatGPT computer-use tools are not
patched automatically. Regular Chrome keeps its extension/DOM route and uses
the configured account profile.

## Real acceptance tests

`test/live-sideusers.mjs` launches two actual MCP clients through the same broker
against disposable x64/x86 app windows. It verifies exclusive window leases,
cross-client refusal through legacy tools, actual button effects, cursor/focus
preservation, private Unicode paste, named Ctrl+A/replacement macros, replay
protection and release/reassignment. Set `MUSE_TEST_SIDESCREEN` to the helper
directory containing the opt-in test fixtures. Results stay on the PC under
`AgentTools/MuseLink/acceptance/sideusers`; screenshots and state are not shipped.
