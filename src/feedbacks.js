/**
 * Feedbacks read from the state cache, which is filled by the values the console
 * pushes. Nothing is polled: the desk sends updates as parameters change, and
 * `/console/resend` primes the cache on connect.
 *
 * Like actions, these are generated from the parameter table so every readable
 * command has a feedback.
 */

import { combineRgb } from '@companion-module/base'
import { buildChannelChoices, buildSendChoices, PARAMETERS, sortKey } from './constants.js'
import { buildChoices, scopeFields } from './fields.js'
import { displayRange, toDisplay, toWire } from './values.js'

const COLOR_WHITE = combineRgb(255, 255, 255)
const COLOR_BLACK = combineRgb(0, 0, 0)
const COLOR_RED = combineRgb(200, 0, 0)
const COLOR_GREEN = combineRgb(0, 150, 0)
const COLOR_AMBER = combineRgb(200, 130, 0)

/** Style hints so the common feedbacks look right the moment they are added. */
const BOOL_STYLES = {
	mute: { bgcolor: COLOR_RED, color: COLOR_WHITE },
	solo: { bgcolor: COLOR_AMBER, color: COLOR_BLACK },
	send_enabled: { bgcolor: COLOR_GREEN, color: COLOR_WHITE },
}

const COMPARATORS = [
	{ id: 'eq', label: '= equal to' },
	{ id: 'ne', label: '≠ not equal to' },
	{ id: 'gt', label: '> greater than' },
	{ id: 'gte', label: '≥ greater than or equal to' },
	{ id: 'lt', label: '< less than' },
	{ id: 'lte', label: '≤ less than or equal to' },
]

function numberField(param) {
	const range = displayRange(param)
	return {
		id: 'value',
		type: 'number',
		label: range.unit ? `Value (${range.unit})` : 'Value',
		default: 0,
		min: range.min ?? -1000000,
		max: range.max ?? 1000000,
		step: range.step ?? 1,
		...(param.negativeInfinityAtMin ? { showMinAsNegativeInfinity: true } : {}),
	}
}

function compare(comparator, actual, expected) {
	switch (comparator) {
		case 'ne':
			return actual !== expected
		case 'gt':
			return actual > expected
		case 'gte':
			return actual >= expected
		case 'lt':
			return actual < expected
		case 'lte':
			return actual <= expected
		case 'eq':
		default:
			// Floats round-trip through 32-bit OSC, so exact equality is not reliable.
			return Math.abs(actual - expected) < 0.0001
	}
}

export function buildFeedbacks(self) {
	const choices = buildChoices(self.model, self.config, {
		channels: buildChannelChoices,
		sends: buildSendChoices,
	})
	const feedbacks = {}

	feedbacks.connected = {
		type: 'boolean',
		name: 'Console: Connected',
		sortName: 'zz_connected',
		description: 'True while the console is answering /console/ping.',
		defaultStyle: { bgcolor: COLOR_GREEN, color: COLOR_WHITE },
		options: [],
		callback: () => self.connection.connected,
	}

	for (const param of PARAMETERS) {
		// A trigger has no value to report back.
		if (param.kind === 'trigger') continue

		const fields = scopeFields(param, choices)
		const label = `${param.category}: ${param.name}`

		if (param.kind === 'bool') {
			feedbacks[param.id] = {
				type: 'boolean',
				name: label,
				sortName: sortKey(param),
				description: `True while ${param.path} is on.`,
				defaultStyle: BOOL_STYLES[param.id] ?? { bgcolor: COLOR_GREEN, color: COLOR_WHITE },
				options: fields,
				callback: (feedback) => self.getParamValue(param, feedback.options) === true,
			}
			continue
		}

		if (param.kind === 'string') {
			feedbacks[param.id] = {
				type: 'boolean',
				name: `${label} (matches)`,
				sortName: sortKey(param),
				description: `Compares ${param.path} against the text below.`,
				defaultStyle: { bgcolor: COLOR_GREEN, color: COLOR_WHITE },
				options: [...fields, { id: 'value', type: 'textinput', label: 'Equals', default: '', useVariables: true }],
				learn: (feedback) => {
					const current = self.getParamValue(param, feedback.options)
					return current === undefined ? undefined : { value: String(current) }
				},
				callback: (feedback) => {
					const current = self.getParamValue(param, feedback.options)
					if (current === undefined) return false
					return String(current) === String(feedback.options.value ?? '')
				},
			}
			continue
		}

		// Numeric comparison.
		feedbacks[param.id] = {
			type: 'boolean',
			name: `${label} (compare)`,
			sortName: sortKey(param),
			description: `Compares ${param.path} against the value below.`,
			defaultStyle: { bgcolor: COLOR_GREEN, color: COLOR_WHITE },
			learn: (feedback) => {
				const current = self.getParamValue(param, feedback.options)
				return current === undefined ? undefined : { value: toDisplay(param, current) }
			},
			options: [
				...fields,
				{
					id: 'comparator',
					type: 'dropdown',
					label: 'Comparison',
					choices: COMPARATORS,
					default: 'gte',
				},
				numberField(param),
			],
			callback: (feedback) => {
				const current = self.getParamValue(param, feedback.options)
				if (current === undefined) return false
				// The cache holds console units; the option is in display units.
				const expected = toWire(param, feedback.options.value)
				if (!Number.isFinite(expected)) return false
				return compare(feedback.options.comparator, Number(current), expected)
			},
		}
	}

	return feedbacks
}
