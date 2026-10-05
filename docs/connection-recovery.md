# Recovering a Muse connection

Inspect the current broker rather than relying on a previously reported PID:

```powershell
node .\bin\muse-link.mjs status
node .\bin\muse-link.mjs chrome chrome_status '{}'
node .\bin\muse-link.mjs sidescreen sidescreen_status '{}'
```

The preferred home is `%USERPROFILE%\AgentTools\MuseLink`. Pause and Resume
use that default, matching the CLI and startup supervisor. Pass
`-HomeDirectory` explicitly for a custom installation. To restart a broker,
run `scripts\Pause-Muse-Link.ps1`, wait for its supervisor to exit, then run
`scripts\Resume-Muse-Link.ps1`. It must run in the signed-in Windows session.
An SSH client forwards the proxy; it does not launch a desktop broker in
Session 0. A broker restart invalidates observations and connection leases.

Engine health records readiness probes with their timestamps. An action
refused because its display ID, window or observation is stale is recorded
separately as `lastOperation`; it no longer overwrites probed readiness or
claims the engine is dead. Until the first probe, readiness is unknown. Call
`sidescreen_status` or `chrome_status` for current health.

Old OpenClaw broker and automation-Chrome keepalive tasks can race the current
installation. Review their task actions, export rollback XML, and disable only
the confirmed obsolete tasks. Pause their associated supervisors before
maintenance. Administrator-owned tasks require normal Windows elevation.
Do not remove Chrome profiles or stop the active broker by an old PID.

SideScreen's CUA supervisor is separate. Updated `start-cua.ps1` retries
transient readiness errors without starting a duplicate daemon while service
state is unknown. Its `state\cua-service\health.json` reports current state.
Pause it through the `paused` file, wait for the owned daemon/supervisor to
exit, remove the file and launch the supervisor in the interactive session.
Fresh status and observation calls are required after recovery; never resend
an action whose outcome is unknown.

On the remote agent, terminate the failed MCP client and reconnect using the
installed `bin/muse-link.mjs mcp agent` over the existing verified SSH
connection. Keep one persistent stdio connection for the task. Discover the
current tool schemas; discard old display IDs, handles, tokens and leases.
Read `sidescreen_status`, then `sidescreen_windows`; copy the returned display
ID as a parsed string, never from multiply escaped console JSON. Call
`chrome_status` and, if necessary, `chrome_ready`, then inspect any stop/focus
receipt before navigation. Regular account work uses `regular_chrome`, not
the separate Patchright automation profile.

An agent-side daemon that cannot initialize MCP needs repair/restart in that
agent's environment. Successful Windows broker checks and local MCP tests do
not prove that daemon, SSH banner exchange or external connectivity works.
Avoid restarting a healthy SSH service merely because its automation client
is wedged. Use the working direct SSH/SCP route while diagnosing wrapper or
tunnel failures independently.
