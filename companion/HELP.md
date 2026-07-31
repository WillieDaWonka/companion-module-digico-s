# DiGiCo S-Series (S21 / S31)

Controls an S-Series console over its **native OSC protocol**, added to the console
software in V3.0 and extended in V3.0.9.

This module does **not** use — and does not take over — the S-Series iPad app
connection. It registers as an OSC controller in the console's own
`Extensions > OSC Control` panel, so the iPad app can stay connected alongside it.

> ⚠ **Channel count upgrade**
>
> The OSC command set built into this module was captured from a **physical S-Series
> console fitted with the 60-input / 24-bus channel count upgrade** (the licensed
> "Channel Count Increase" feature introduced in V3.0.9).
>
> **Consoles without that upgrade may not work properly.** A standard 48/16 console does
> not expose input channels 49–60 or busses 17–24 (OSC numbers 86–93). Commands sent to
> those channels are ignored by the desk, and any feedback or variable bound to them
> stays empty. Parameter ranges and addresses were read from an upgraded console and have
> not been verified against every earlier software build.
>
> Set **Console channel / bus mode** in the connection config to match your desk. Check
> `Settings > Upgrade` on the console if you are unsure which you have.

---

## Requirements

- DiGiCo S21 or S31 running **software V3.0.9 or later**
- The console and Companion on the same network

## Console setup

On the console, go to **Extensions > OSC Control**:

1. **Enable OSC** and set the **console receive port**. This is the port Companion sends
   commands to — enter the same number as _Console receive port_ in the connection config.
2. Press **Add Controller** and enter the IP address of the machine running Companion.
3. Set that controller's **send port** to the _Companion listen port_ from the connection
   config. This is the port the console pushes updates to.
4. Make sure both the **send** and **receive** buttons are enabled for that controller.

Only **one controller can be active on the console at a time**. If something else (a
tablet running an OSC app, QLab, a lighting desk) is already registered and active, the
console will not talk to Companion.

### Port settings are a crossover

There are no fixed defaults; the console lets you choose. The two ports must be wired
across:

| Companion config field    | Must equal                                     |
| ------------------------- | ---------------------------------------------- |
| Console receive port      | The console's **receive port** (OSC Config)    |
| Companion listen port     | The controller's **send port** (Controllers)   |

## Connection status

The module sends `/console/ping` every 3 seconds and expects `/console/pong` back. The
connection shows as **OK** only once the console has replied. If it stays in error with
_"No reply from console"_, the desk is not sending to Companion — re-check step 2–4 above,
and confirm no other controller has taken the active slot.

## Keeping in sync

The console only reports a value when it **changes** — so anything set before Companion
connected, or changed by another controller, or lost to a dropped UDP packet, never
arrives on its own. Two settings fix that automatically:

- **Request full state on connect** — asks the desk to push everything as soon as the
  connection comes up, so variables, feedbacks and channel names populate immediately
  rather than waiting for the next fader move.
- **Automatic refresh interval** — repeats that request on a timer (60 seconds by
  default) so state keeps self-healing for as long as the connection stays up. Set it to
  `0` to turn this off and rely only on connect-time sync plus whatever the console
  pushes unprompted.

Both need the controller's **receive** enabled on the console (step 4 above) — without
it, the desk has nowhere to push the reply to. A full resend can be a burst of thousands
of messages on a busy session; lower the interval for faster sync at the cost of more
network traffic, or raise it on a slow or congested network.

---

## Channel numbering

Everything is addressed by an **OSC channel number**, not by a fader position. These are
fixed by the console:

| Range        | OSC numbers    | Notes                                             |
| ------------ | -------------- | ------------------------------------------------- |
| Input channels | 1–60         | 1–48 on a console without the upgrade             |
| Aux busses     | 70–79        | 10 auxes in a default session                     |
| Group busses   | 80–93        | 80–85 only on a console without the upgrade       |
| Matrix         | 100–107      |                                                   |
| Control groups | 110–119      |                                                   |
| Master bus     | 120          |                                                   |

Two things to know:

- **Bus mode does not change the OSC number.** Each S-Series bus can be switched between
  Aux and Group mode; its OSC number stays the same. The Aux/Group labels in the dropdowns
  reflect a _default_ session, so "Aux 3" addresses whatever bus 3 currently is.
- **Solo 1 and Solo 2 cannot be controlled over OSC.** This is a console limitation.

Every channel dropdown accepts a **typed-in custom value**, so you can address a number
that is not in the list.

## Band numbering

EQ and dynamics bands are **zero-based over OSC**, which the console's own help confirms:
the 4th EQ band gain on input 2 is `/channel/2/eq/3/gain`. The dropdowns are labelled
Band 1–4 but their values are the indices actually sent.

This is the one part of the command set where the available sources disagree, and getting
it wrong shifts every band by one without any error. If EQ or dynamics changes land on the
wrong band, switch **EQ / dynamics band numbering** in the connection config to "Bands
start at 1" and re-pick the band on your buttons.

## Aux sends and group assignment

Send actions use `/channel/{channel}/send/{send}/level`, where **`{send}` is the OSC number
of the destination bus** — not a 1–24 slot index. So sending input 5 to Group 1 is
`/channel/5/send/80/enabled`.

This is why one command covers both "Aux Send On/Off" and "Group Assign" in the console's
table: assigning a channel to a group, a control group (110–119) or the master bus (120) is
just enabling its send to that bus. The **Send to** dropdown lists every bus, and accepts a
typed-in number.

## Time values

Attack, release, hold and input delay are held in **seconds** by the console, but entering
`0.0005` for an attack is awkward, so the module shows these fields in **milliseconds** and
converts. Ranges in the UI read 0.5–100 ms, 0–682 ms and so on.

The **Send custom OSC command** action bypasses this — write seconds there.

---

## Actions

Every command on the console's OSC list is available. Continuous parameters additionally
get an **(adjust by)** action for relative changes, and levels and pans get a **(fade to)**
action that ramps over a duration you choose.

Relative and toggle actions need to know the current value, so they only work once the
console has reported it — keep **Request full state on connect** enabled.

Most actions support Companion's **Learn** button: set the channel, move the control on the
desk, then press Learn to capture the console's current value into the action.

Three utility actions are worth knowing:

- **Console: Resend all properties** — asks the desk to push everything again, repopulating
  feedbacks and variables.
- **Console: Query a parameter value** — sends one address with no arguments, which makes
  the console reply with that value.
- **Console: Send custom OSC command** — an escape hatch for anything this module does not
  model, or for a console whose OSC addresses have been edited.

## Feedbacks

Boolean parameters (mute, solo, EQ enabled, send on, …) get a straight on/off feedback.
Numeric parameters get a **comparison** feedback so you can light a button when, say, a
fader is above a threshold.

Feedbacks are driven entirely by what the console pushes — nothing is polled.

## Variables

Connection info, plus name / fader / mute / solo for every channel, using readable slugs:

```
$(digico-s-series:input_1_name)     $(digico-s-series:input_1_fader)
$(digico-s-series:aux_3_mute)       $(digico-s-series:group_2_solo)
$(digico-s-series:master_fader)     $(digico-s-series:connected)
```

A fader at its minimum reads as `-inf`.

---

## Levels

Faders and aux sends run **−90 to +10 dB**. The bottom of travel displays as **−∞**.

(The console's exported table describes the fader as −150…+10, where −150 is its true −∞.
The working range is presented instead, since −90 dB is silence for any practical purpose.
Use **Send custom OSC command** if you need to drive a fader below −90.)

## Protocol format options

**Boolean format** controls how mute, solo, send-on and the various "enabled" parameters
are put on the wire. Sources disagree on what the S-Series expects — its command table says
`true`/`false`, which in OSC means the `T`/`F` type tags, but the desk has also been
reported to accept the literal text `"true"`/`"false"`.

The default, **Auto**, sidesteps the question: the module starts with OSC type tags and
then switches to whatever format the console itself uses as soon as it reports a boolean.
Whatever the desk sends, it accepts. This needs the controller's **receive** enabled on the
console; you will see a line in the Companion log when it adapts.

If mutes still do not respond, pin a specific format — try **Text "true" / "false"**.

The console's **OSC Commands** editor can also globally rescale the command set. Its
"normalise" buttons turn every continuous range into 0.0–1.0 and switch booleans to `0`/`1`;
if you have pressed them, set **Continuous values normalised** and the matching boolean
format here. The editor also allows inverting individual booleans and editing individual
addresses — the module assumes neither has been done.

## Troubleshooting

**Connection never reaches OK.** The console is not sending to Companion. Check the
controller entry's IP is this machine, its send port matches _Companion listen port_, and
both send and receive are enabled. Remember only one controller can be active at a time.

**Commands work but nothing lights up.** Feedback needs the console's receive direction.
Enable the controller's **receive** button on the desk and turn on _Request full state on
connect_.

**Levels and EQ work but mutes do not.** That is the boolean format. Leave **Boolean
format** on Auto and make sure the controller's **receive** is enabled on the desk so the
module can observe the console's own encoding; failing that, pin **Text "true" / "false"**.

**Everything inverted or values wildly wrong.** The command set has been normalised on the
console — match the Protocol format settings in the config.

**Some channels do nothing.** They probably do not exist on your desk. See the channel
count warning at the top.

**Discovering what your console actually sends.** Enable **Log received OSC messages** in
the config and watch the Companion log while you move controls on the desk. This shows the
exact addresses and value types your console uses.

## Assumptions and known deviations

- The console's exported command table lists **EQ Band Gain** with a range of `18..18`,
  which cannot be right for a symmetric bell gain. It is treated as **−18…+18 dB**.
- `DiGiTube Bias`, `Dyn Mode` and `Knee` are documented only as `int` with no range. They
  are offered as 0–10; use a custom OSC command if your console accepts more.
- Dynamics 1 is exposed with three bands (multiband mode). Band 1 is used for single-band
  operation.
- **Aux Send Level** is offered as −90…0 dB, the range in the console's exported table.
  If your desk allows sends above unity, use a custom OSC command.
- Busses are offered as OSC 70–93 (10 aux + 14 groups = the 24 the upgrade provides), per
  the V3.0.9 release notes. The exported spreadsheet writes the range as 70–94; if bus 94
  exists on your desk, type it into any channel or send field.
