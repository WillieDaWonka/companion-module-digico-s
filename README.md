# companion-module-digico-s-series

A [Bitfocus Companion](https://bitfocus.io/companion) module for **DiGiCo S-Series**
consoles (S21 / S31), built on the console's native OSC protocol.

See [companion/HELP.md](companion/HELP.md) for setup and usage.

## Why a separate module

The existing `digico-osc` module targets the SD range and its S-Series support is partial.
This module was written specifically for the S-Series OSC implementation introduced in
console software V3.0, and differs in four ways that matter:

- **It does not take over the iPad connection.** It registers as an OSC controller in the
  console's own `Extensions > OSC Control` panel, so the S-Series iPad app can remain
  connected.
- **It can send every boolean encoding the desk might want.** Companion's built-in
  `oscSend()` only emits `i`/`f`/`s`/`b` and cannot produce the OSC `T`/`F` type tags the
  console's command table implies, so this module carries its own OSC codec over a UDP
  socket. Because sources disagree on which encoding the S-Series actually wants, the
  default is to watch what the console sends and match it.
- **It covers the whole documented command set** — channel input, EQ, dynamics 1 and 2,
  aux sends and group assigns, snapshots — with feedback on all of it, rather than a
  handful of actions.
- **It keeps itself in sync.** The console only reports a value when it changes, so
  anything set before Companion connected never arrives on its own. The module resyncs
  on connect and then on a configurable interval (see "Automatic refresh interval" in the
  connection config), so variables, feedbacks and channel names self-heal without the
  user pressing anything.

## Command set provenance

The parameter table in [`src/constants.js`](src/constants.js) was transcribed from the OSC
Commands table exported from a **physical S-Series console fitted with the 60-input /
24-bus channel count upgrade**, cross-checked against the
[S-Series V3.0.9 release notes](https://digico.biz/wp-content/uploads/2022/06/S21_S31-Release-Notes-V3.0.9.pdf)
(section 1.5, "OSC control"), and against an earlier independent implementation,
[WillieDaWonka/companion-module-digico-s](https://github.com/WillieDaWonka/companion-module-digico-s).

That earlier module's address list matches this one command for command, which is good
corroboration of the transcription. Three things were carried across from it:

- **`{send}` is the destination bus OSC number**, not a 1–24 slot index. That is the only
  reading under which "Aux Send On/Off **or Group Assign**" can also assign a channel to a
  control group (110–119) or the master bus (120).
- **EQ band gain is ±18 dB**, confirming that the exported table's `18..18` is a typo.
- **Sub-second times are entered in milliseconds** and converted, rather than making the
  user type `0.0005`.

The two implementations disagree on two points, and both are resolved in the config rather
than by picking a side:

- **Band numbering.** The earlier module indexes EQ and dynamics bands from 1; DiGiCo's own
  console help gives `/channel/2/eq/3/gain` as the 4th EQ band. This module defaults to
  zero-based per DiGiCo, with an option to switch, because a wrong guess silently shifts
  every band by one.
- **Boolean encoding.** The earlier module sends the literal strings `"true"`/`"false"` and
  is reported to have worked for mute; the command table implies OSC `T`/`F` type tags.
  This module defaults to **Auto**, adopting whatever encoding the console is heard using,
  and can be pinned to tags, text or `0`/`1`.

**Consoles without the channel count upgrade may not work properly** — see the warning in
the connection config and in HELP.md.

## Development

Requires Node 22.

```bash
npm install
```

Run the test suite:

```bash
npm test
```

Format:

```bash
npm run format
```

The tests cover the OSC codec, address attribution, value encoding under both console
format modes, and the generated action/feedback/preset/variable definitions. They run
without a console attached.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/main.js` | Instance lifecycle, message dispatch, fades, update batching |
| `src/constants.js` | The console's OSC command set and channel model |
| `src/osc-codec.js` | Dependency-free OSC 1.0 encode/decode |
| `src/connection.js` | UDP transport, ping/pong keepalive |
| `src/state.js` | Value cache and address-to-parameter attribution |
| `src/values.js` | Real units ↔ the console's configured OSC types |
| `src/actions.js`, `src/feedbacks.js`, `src/presets.js`, `src/variables.js` | Definitions generated from the parameter table |
| `src/config.js` | Connection config UI |
| `src/poller.js` | Scheduling for the periodic `/console/resend` that keeps state in sync |

Actions and feedbacks are generated from the parameter table rather than hand-written, so
adding a command is a matter of adding one entry to `PARAMETERS`.

## License

MIT
