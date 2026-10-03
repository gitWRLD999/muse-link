# Chrome desktop and visual input

The `agent` channel keeps the real, explicitly pinned Chrome profile. It now
has three complementary routes:

| Surface | Observe | Input |
| --- | --- | --- |
| Webpage controls | `snapshot` / `find` | `act` / `steps` |
| Webpage pixels / canvas | `chrome_visual_observe` | `chrome_visual_act` |
| Chrome browser UI, including account chooser bubbles | `chrome_desktop_observe` | `chrome_desktop_act` |

The small Chrome account chooser (FedCM) is browser UI. It need not appear in
the page DOM or page screenshot. Whole-window CUA captures include that UI,
and its accessibility controls can provide background `invoke` actions. This
is not a claim that all Chrome or Windows prompts support background input.
Use the advertised controls and inspect the returned outcome.

Start with `chrome_ready`. Desktop observation discovers the actual native
window from the verified active owned tab, exact title and current bounds.
Ambiguous matches, a human tab in the same window, inactive selected tabs,
changed document/process/display/geometry, expired observations and replay are refused.
It never injects the native SideUser keyboard/pointer DLL into Chrome. Native
browser actions require the separate `SideScreen.ChromeFocus` activation-only
guard. That user-mode DLL is loaded into Chrome's GUI thread and hooks five
window activation/focus APIs only. Physical keyboard, pointer, clipboard,
renderer input and all other Chrome roots pass through. A guarded root expires
120 seconds after its last native action; explicitly foregrounding that root
restores its ordinary focus behavior. The DLL stays pinned until Chrome exits,
so updating that DLL requires closing Chrome first; human and agent windows can
share its process. This scoped
guard is not a separate Windows session or a universal app isolation boundary.

`chrome_desktop_act` takes its returned `observationId`, a CUA `tool`, and
`arguments`, such as `{element_token:"<returned token>"}` for `click`. It forces
background delivery through the existing SideScreen boundary, arms the Chrome
activation guard before dispatch, and returns a
fresh image and tree after successful dispatch. Inspect those to confirm the
actual result. An error, unknown effect or focus change is a stopping point;
there is no fallback to Windows foreground input or profile replacement.

Choose an account only when the user's intended identity and destination are
clear. A browser account selection and OAuth access consent are distinct
steps. These tools do not authorize unrequested account/access changes or
bypass passwords, MFA, passkeys, security blocks or provider restrictions.

`chrome_visual_observe` returns a PNG plus `observation_id`, image dimensions
and capture metadata. `chrome_visual_act` supports `click`, `move`, `scroll`,
`type`, and a bounded `press` key list. Pixel coordinates refer to that PNG;
the bridge converts them into the captured viewport's CSS coordinates. It
checks the same tab, document loader, URL, viewport and display/window geometry,
then consumes the observation before dispatch. Click the intended editable
surface and inspect its fresh state before typing. Input is delivered to the
exact page through Chrome's existing debugger extension; it never uses the
Windows cursor, keyboard queue or clipboard. It does not click browser UI.

Chrome cold attachment can still activate a window. Preparation stops before
the requested business action when that is detected. Keep one persistent MCP
connection; after a preparation stop inspect `chrome_status`. There is no
automatic action replay or foreground restoration.

`test/live-chrome-chooser.mjs` serves a loopback-only identity provider with
fictional accounts and opens Chrome's real FedCM account chooser. It uses the
same persistent MCP proxy as Muse. No Google account credentials, live identity
tokens or third-party login are used by that test. Reports and screenshots
remain in the private local acceptance directory.

Local acceptance for 1.4 passed through the installed persistent agent MCP:
Chrome exposed both fictional accounts, account selection revealed its native
Continue button, and Continue completed the loopback FedCM exchange. Both
native actions preserved foreground, keyboard focus and cursor. Trusted page
click, Unicode typing, Backspace and scrolling also preserved those inputs;
the fixture independently verified trusted events and the changed page state.
This tests Chrome's actual chooser, not a real Google/OpenTrain sign-in or
every possible browser prompt. Read-only observation can also be interrupted
by a focus change; it stops and requires fresh state, without retrying input.
