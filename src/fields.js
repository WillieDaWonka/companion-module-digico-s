/** Option-field builders shared between actions and feedbacks. */

import { Regex } from '@companion-module/base'
import { buildDynBandChoices, buildEqBandChoices, resolvePath } from './constants.js'

export function channelField(choices) {
	return {
		id: 'channel',
		type: 'dropdown',
		label: 'Channel',
		choices,
		default: choices[0].id,
		allowCustom: true,
		regex: Regex.NUMBER,
		minChoicesForSearch: 0,
		tooltip:
			'Aux/Group labels reflect a default session. Switching a bus between Aux and Group mode on the ' +
			'console does not change its OSC number. Any OSC number can be typed in directly.',
	}
}

export function bandField(choices, label) {
	return {
		id: 'band',
		type: 'dropdown',
		label,
		choices,
		default: choices[0].id,
		allowCustom: true,
		regex: Regex.NUMBER,
		tooltip:
			'The number shown is the index sent over OSC. Change "Band numbering" in the connection ' +
			'config if your console indexes bands from 1.',
	}
}

export function sendField(choices) {
	return {
		id: 'send',
		type: 'dropdown',
		label: 'Send to (destination bus)',
		choices,
		default: choices[0].id,
		allowCustom: true,
		regex: Regex.NUMBER,
		minChoicesForSearch: 0,
		tooltip:
			'The destination bus OSC number. Enabling a send to a Group or Control Group is how a ' +
			'channel is assigned to it.',
	}
}

/** The option fields a parameter needs in order to identify its target. */
export function scopeFields(param, choices) {
	const fields = []
	if (param.scope !== 'global') fields.push(channelField(choices.channels))
	if (param.scope === 'eqband') fields.push(bandField(choices.eqBands, 'EQ band'))
	if (param.scope === 'dynband') fields.push(bandField(choices.dynBands, 'Dynamics band'))
	if (param.scope === 'send') fields.push(sendField(choices.sends))
	return fields
}

/** Every dropdown choice list an action or feedback might need, for one config. */
export function buildChoices(model, config, builders) {
	return {
		channels: builders.channels(model),
		sends: builders.sends(model),
		eqBands: buildEqBandChoices(config.bandBase),
		dynBands: buildDynBandChoices(config.bandBase),
	}
}

/**
 * Resolve a parameter's OSC address from user-selected options.
 * @throws if a required index is missing or non-numeric (dropdowns with `allowCustom`
 *   hand back free text, so this cannot be assumed valid).
 */
export function pathFromOptions(param, options) {
	const vars = {}
	if (param.scope !== 'global') vars.channel = Number(options.channel)
	if (param.scope === 'eqband' || param.scope === 'dynband') vars.band = Number(options.band)
	if (param.scope === 'send') vars.send = Number(options.send)

	for (const [key, value] of Object.entries(vars)) {
		if (!Number.isFinite(value)) throw new Error(`invalid ${key} value "${options[key]}"`)
	}
	return resolvePath(param.path, vars)
}
