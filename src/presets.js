/**
 * Ready-made buttons. Companion 4 takes presets as two pieces: a `structure` of
 * sections/groups that organises the picker, and a flat map of preset definitions the
 * structure refers to by id.
 */

import { combineRgb } from '@companion-module/base'
import { buildChannelDescriptors } from './constants.js'

/**
 * Presets reference this module's own variables by the module id; Companion rewrites
 * the prefix to whatever the user has named the connection when the preset is placed.
 * Must match `id` in companion/manifest.json.
 */
const MODULE_ID = 'digico-s-series'

const v = (variableId) => `$(${MODULE_ID}:${variableId})`

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARK = combineRgb(0, 0, 0)
const RED = combineRgb(200, 0, 0)
const AMBER = combineRgb(200, 130, 0)
const GREEN = combineRgb(0, 150, 0)
const BLUE = combineRgb(0, 60, 150)

function baseStyle(text, bgcolor = DARK, color = WHITE) {
	return { text, size: '14', color, bgcolor }
}

export function buildPresets(model) {
	const presets = {}
	const channels = buildChannelDescriptors(model)

	const muteIds = []
	const soloIds = []
	const faderIds = []

	for (const channel of channels) {
		const muteId = `mute_${channel.slug}`
		presets[muteId] = {
			type: 'simple',
			name: `Mute ${channel.label}`,
			keywords: ['mute', channel.slug],
			style: baseStyle(`${v(`${channel.slug}_name`)}\nMUTE`),
			steps: [
				{
					down: [{ actionId: 'mute', options: { channel: channel.osc, mode: 'toggle' } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'mute',
					options: { channel: channel.osc },
					style: { bgcolor: RED, color: WHITE },
				},
			],
		}
		muteIds.push(muteId)

		const soloId = `solo_${channel.slug}`
		presets[soloId] = {
			type: 'simple',
			name: `Solo ${channel.label}`,
			keywords: ['solo', 'pfl', channel.slug],
			style: baseStyle(`${v(`${channel.slug}_name`)}\nSOLO`),
			steps: [
				{
					down: [{ actionId: 'solo', options: { channel: channel.osc, mode: 'toggle' } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'solo',
					options: { channel: channel.osc },
					style: { bgcolor: AMBER, color: BLACK },
				},
			],
		}
		soloIds.push(soloId)

		const faderId = `fader_${channel.slug}`
		presets[faderId] = {
			type: 'simple',
			name: `Fader readout ${channel.label}`,
			keywords: ['fader', 'level', channel.slug],
			style: baseStyle(`${v(`${channel.slug}_name`)}\n${v(`${channel.slug}_fader`)} dB`),
			steps: [
				{
					down: [],
					up: [],
					rotate_left: [{ actionId: 'fader_delta', options: { channel: channel.osc, delta: -1 } }],
					rotate_right: [{ actionId: 'fader_delta', options: { channel: channel.osc, delta: 1 } }],
				},
			],
			feedbacks: [],
		}
		faderIds.push(faderId)
	}

	// --- Snapshots ------------------------------------------------------------
	presets.snapshot_next = {
		type: 'simple',
		name: 'Next snapshot',
		keywords: ['snapshot', 'next', 'cue'],
		style: baseStyle('NEXT\nSNAP', BLUE),
		steps: [{ down: [{ actionId: 'snapshot_next', options: {} }], up: [] }],
		feedbacks: [],
	}
	presets.snapshot_previous = {
		type: 'simple',
		name: 'Previous snapshot',
		keywords: ['snapshot', 'previous', 'cue'],
		style: baseStyle('PREV\nSNAP', BLUE),
		steps: [{ down: [{ actionId: 'snapshot_previous', options: {} }], up: [] }],
		feedbacks: [],
	}

	const snapshotFireIds = []
	for (let i = 1; i <= 20; i++) {
		const id = `snapshot_fire_${i}`
		presets[id] = {
			type: 'simple',
			name: `Fire snapshot ${i}`,
			keywords: ['snapshot', 'fire', 'recall', String(i)],
			style: baseStyle(`SNAP\n${i}`, BLUE),
			steps: [{ down: [{ actionId: 'snapshot_fire', options: { value: i } }], up: [] }],
			feedbacks: [],
		}
		snapshotFireIds.push(id)
	}

	// --- Console --------------------------------------------------------------
	presets.console_status = {
		type: 'simple',
		name: 'Console connection status',
		keywords: ['status', 'connected', 'ping'],
		style: baseStyle('CONSOLE\nOFFLINE', RED),
		steps: [{ down: [], up: [] }],
		feedbacks: [
			{
				feedbackId: 'connected',
				options: {},
				style: { text: 'CONSOLE\nONLINE', bgcolor: GREEN, color: WHITE },
			},
		],
	}
	presets.console_resend = {
		type: 'simple',
		name: 'Resend all properties',
		keywords: ['sync', 'refresh', 'resend'],
		style: baseStyle('SYNC\nDESK'),
		steps: [{ down: [{ actionId: 'console_request_resend', options: {} }], up: [] }],
		feedbacks: [],
	}

	const structure = [
		{
			id: 'console',
			name: 'Console',
			description: 'Connection status and state synchronisation.',
			definitions: ['console_status', 'console_resend'],
		},
		{
			id: 'snapshots',
			name: 'Snapshots',
			description: 'Snapshot navigation and direct recall.',
			definitions: [
				{ id: 'snapshot_nav', type: 'simple', name: 'Navigation', presets: ['snapshot_next', 'snapshot_previous'] },
				{ id: 'snapshot_recall', type: 'simple', name: 'Fire by number', presets: snapshotFireIds },
			],
		},
		{
			id: 'mutes',
			name: 'Mutes',
			description: 'Toggle mute, lit red while the channel is muted.',
			definitions: [{ id: 'mutes_all', type: 'simple', name: 'All channels', presets: muteIds }],
		},
		{
			id: 'solos',
			name: 'Solos',
			description: 'Toggle solo, lit amber while the channel is soloed.',
			definitions: [{ id: 'solos_all', type: 'simple', name: 'All channels', presets: soloIds }],
		},
		{
			id: 'faders',
			name: 'Faders',
			description: 'Level readout; rotate on a supported surface to trim by 1 dB.',
			definitions: [{ id: 'faders_all', type: 'simple', name: 'All channels', presets: faderIds }],
		},
	]

	return { structure, presets }
}
