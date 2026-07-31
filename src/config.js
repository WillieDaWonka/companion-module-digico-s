import { Regex } from '@companion-module/base'
import { BAND_BASE, BOOL_FORMAT, CHANNEL_MODE } from './constants.js'

export const DEFAULT_CONFIG = {
	host: '',
	consolePort: 8000,
	localPort: 9000,
	channelMode: CHANNEL_MODE.EXPANDED,
	bandBase: BAND_BASE.ZERO,
	boolFormat: BOOL_FORMAT.AUTO,
	normalise: false,
	resendOnConnect: true,
	pollIntervalSec: 60,
	logInbound: false,
	logOutbound: false,
}

export function getConfigFields() {
	return [
		{
			id: 'intro',
			type: 'static-text',
			label: 'DiGiCo S-Series (S21 / S31)',
			width: 12,
			value:
				'Controls an S-Series console over its native OSC protocol (Extensions &gt; OSC Control), ' +
				'introduced in console software V3.0. This does <strong>not</strong> use, or take over, the S-Series iPad app connection. ' +
				'Requires console software V3.0.9 or later.',
		},

		{
			id: 'setup',
			type: 'static-text',
			label: 'Console setup',
			width: 12,
			value:
				'On the console go to <strong>Extensions &gt; OSC Control</strong>:<br />' +
				'1. Enable OSC and set the <strong>console receive port</strong> — enter the same number below as "Console receive port".<br />' +
				"2. Press <strong>Add Controller</strong> and enter this Companion machine's IP address.<br />" +
				'3. Set that controller\'s <strong>send port</strong> to the "Companion listen port" below, and enable both its send and receive buttons.<br />' +
				'Only one controller can be active on the console at a time.',
		},

		{
			id: 'host',
			type: 'textinput',
			label: 'Console IP address',
			width: 6,
			default: DEFAULT_CONFIG.host,
			regex: Regex.IP,
		},
		{
			id: 'consolePort',
			type: 'number',
			label: 'Console receive port',
			tooltip: 'The port set in the console OSC Configuration view. Companion sends commands here.',
			width: 3,
			min: 1,
			max: 65535,
			step: 1,
			asInteger: true,
			default: DEFAULT_CONFIG.consolePort,
		},
		{
			id: 'localPort',
			type: 'number',
			label: 'Companion listen port',
			tooltip: "The controller 'send port' configured on the console. Companion listens here for updates.",
			width: 3,
			min: 1,
			max: 65535,
			step: 1,
			asInteger: true,
			default: DEFAULT_CONFIG.localPort,
		},

		// --- Channel count ----------------------------------------------------
		{
			id: 'channelCountWarning',
			type: 'static-text',
			label: '⚠ Channel count upgrade',
			width: 12,
			value:
				'The OSC command set built into this module was captured from a <strong>physical S-Series console fitted with the ' +
				'60-input / 24-bus channel count upgrade</strong> (the licensed "Channel Count Increase" feature added in V3.0.9).<br /><br />' +
				'<strong>Consoles without that upgrade may not work properly.</strong> A standard 48/16 console does not expose ' +
				'input channels 49–60 or busses 17–24 (OSC numbers 86–93); commands addressed to them are ignored by the desk, ' +
				'and any feedback or variable bound to them will stay empty. Parameter ranges and addresses were also read from an ' +
				'upgraded console and have not been verified against every earlier software build.<br /><br />' +
				'Set the mode below to match your console so that only the channels it actually has are offered.',
		},
		{
			id: 'channelMode',
			type: 'dropdown',
			label: 'Console channel / bus mode',
			width: 6,
			default: DEFAULT_CONFIG.channelMode,
			choices: [
				{ id: CHANNEL_MODE.EXPANDED, label: '60 inputs / 24 busses — channel count upgrade fitted' },
				{ id: CHANNEL_MODE.STANDARD, label: '48 inputs / 16 busses — standard console' },
			],
			tooltip:
				'Determines which channels and busses appear in action and feedback dropdowns. ' +
				'Check Settings > Upgrade on the console if you are unsure.',
		},
		{
			id: 'resendOnConnect',
			type: 'checkbox',
			label: 'Request full state on connect',
			width: 6,
			default: DEFAULT_CONFIG.resendOnConnect,
			tooltip:
				'Sends /console/resend as soon as the console answers, so feedbacks, variables and channel names ' +
				'populate immediately instead of waiting for something to change on the desk.',
		},
		{
			id: 'pollIntervalSec',
			type: 'number',
			label: 'Automatic refresh interval (seconds, 0 = off)',
			width: 6,
			min: 0,
			max: 3600,
			step: 5,
			asInteger: true,
			clampValues: true,
			default: DEFAULT_CONFIG.pollIntervalSec,
			tooltip:
				'Repeats /console/resend on this interval so variables, feedbacks and channel names keep ' +
				'themselves in sync — including anything the console changed on its own, or a value missed to ' +
				'a dropped UDP packet. 0 disables this and relies only on "Request full state on connect" plus ' +
				'whatever the console pushes unprompted. Lower values sync faster at the cost of more traffic; ' +
				'a full resend can be a burst of thousands of messages on a busy session.',
		},

		// --- Protocol options -------------------------------------------------
		{
			id: 'protocolHeading',
			type: 'static-text',
			label: 'Protocol format',
			width: 12,
			value:
				"Leave these at their defaults unless you have changed the value types in the console's " +
				'<strong>OSC Commands</strong> editor. The editor\'s "normalise" buttons rescale every continuous range to 0.0–1.0 ' +
				'and switch booleans from true/false to 0/1; if you have pressed them, match the settings here.',
		},
		{
			id: 'boolFormat',
			type: 'dropdown',
			label: 'Boolean format (mute, solo, sends, enables)',
			width: 6,
			default: DEFAULT_CONFIG.boolFormat,
			choices: [
				{ id: BOOL_FORMAT.AUTO, label: 'Auto — match whatever the console sends (recommended)' },
				{ id: BOOL_FORMAT.TRUE_FALSE, label: 'OSC true / false type tags' },
				{ id: BOOL_FORMAT.STRING, label: 'Text "true" / "false"' },
				{ id: BOOL_FORMAT.INT, label: 'Integer 0 / 1 — normalised' },
			],
			tooltip:
				'Auto starts with OSC type tags and switches to whatever the console uses as soon as it reports ' +
				'a boolean, which needs the controller\'s "receive" enabled on the desk. ' +
				'Pin a specific format here if mutes or sends do not respond.',
		},
		{
			id: 'bandBase',
			type: 'dropdown',
			label: 'EQ / dynamics band numbering',
			width: 6,
			default: DEFAULT_CONFIG.bandBase,
			choices: [
				{ id: BAND_BASE.ZERO, label: 'Bands start at 0 — per DiGiCo documentation' },
				{ id: BAND_BASE.ONE, label: 'Bands start at 1' },
			],
			tooltip:
				"DiGiCo's console help gives /channel/2/eq/3/gain as the 4th EQ band, so band indices start at 0. " +
				'If EQ or dynamics changes land on the wrong band, switch this and re-pick the band on your buttons.',
		},
		{
			id: 'normalise',
			type: 'checkbox',
			label: 'Continuous values normalised to 0.0–1.0',
			width: 6,
			default: DEFAULT_CONFIG.normalise,
			tooltip: 'Enable only if you normalised the continuous ranges in the console OSC Commands editor.',
		},

		// --- Diagnostics ------------------------------------------------------
		{
			id: 'logInbound',
			type: 'checkbox',
			label: 'Log received OSC messages',
			width: 6,
			default: DEFAULT_CONFIG.logInbound,
			tooltip:
				'Writes every message from the console to the Companion log. Useful for discovering addresses ' +
				'that differ on your console; noisy in normal use.',
		},
		{
			id: 'logOutbound',
			type: 'checkbox',
			label: 'Log sent OSC messages',
			width: 6,
			default: DEFAULT_CONFIG.logOutbound,
		},
	]
}

/**
 * Coerce to a non-negative integer, falling back when the input can't produce one.
 * Unlike `Number(x) || fallback`, this keeps an explicit 0 rather than treating it as
 * missing - which matters for pollIntervalSec, where 0 means "disabled". null/undefined
 * are treated as missing rather than 0, even though `Number(null) === 0`.
 */
function toNonNegativeInt(value, fallback) {
	if (value === null || value === undefined || value === '') return fallback
	const num = Math.round(Number(value))
	return Number.isFinite(num) && num >= 0 ? num : fallback
}

/** Fill in defaults so a partially-populated config never produces NaN ports. */
export function normaliseConfig(config) {
	const merged = { ...DEFAULT_CONFIG, ...(config ?? {}) }
	merged.consolePort = Number(merged.consolePort) || DEFAULT_CONFIG.consolePort
	merged.localPort = Number(merged.localPort) || DEFAULT_CONFIG.localPort
	merged.pollIntervalSec = toNonNegativeInt(merged.pollIntervalSec, DEFAULT_CONFIG.pollIntervalSec)
	merged.host = String(merged.host ?? '').trim()
	return merged
}
