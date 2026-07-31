/**
 * Actions are generated from the parameter table in constants.js rather than written
 * out by hand, so every command on the console's OSC list is reachable and they all
 * behave consistently.
 *
 * Each writable parameter yields a "set" action; continuous ones additionally yield a
 * relative "adjust" action, and level/pan controls a timed "fade to" action.
 */

import { buildChannelChoices, buildSendChoices, PARAMETERS, sortKey } from './constants.js'
import { bandField, buildChoices, channelField, pathFromOptions, scopeFields, sendField } from './fields.js'
import { displayRange, toDisplay, toWire } from './values.js'

/** Shown under the action name, so the address is visible when troubleshooting. */
function describe(param, extra) {
	return extra ? `${extra} Sends ${param.path}` : `Sends ${param.path}`
}

/**
 * Fill the action's value from what the console currently reports, so a user can dial the
 * desk in by hand and capture it rather than typing numbers.
 */
function learnValue(self, param) {
	return (action) => {
		const current = self.getParamValue(param, action.options)
		if (current === undefined) return undefined
		return { value: param.kind === 'string' ? String(current) : toDisplay(param, current) }
	}
}

function valueField(param) {
	if (param.kind === 'string') {
		return { id: 'value', type: 'textinput', label: 'Value', default: '', useVariables: true }
	}

	if (param.kind === 'int' && param.enumLabels) {
		return {
			id: 'value',
			type: 'dropdown',
			label: 'Value',
			choices: param.enumLabels,
			default: param.enumLabels[0].id,
		}
	}

	const range = displayRange(param)
	const field = {
		id: 'value',
		type: 'number',
		label: range.unit ? `Value (${range.unit})` : 'Value',
		default: defaultValueFor(param),
		min: range.min ?? -1000000,
		max: range.max ?? 1000000,
		step: range.step ?? 1,
		clampValues: true,
	}
	if (param.kind === 'int') field.asInteger = true
	if (param.negativeInfinityAtMin) field.showMinAsNegativeInfinity = true
	// A slider is helpful for bounded, human-scaled ranges but useless across 20-20000 Hz.
	if (param.kind === 'float' && range.max - range.min <= 200) field.range = true
	return field
}

function defaultValueFor(param) {
	if (param.id === 'fader' || param.id === 'send_level') return 0
	const range = displayRange(param)
	if (param.kind === 'int') return range.min ?? 0
	if (range.min !== undefined && range.max !== undefined && range.min <= 0 && range.max >= 0) return 0
	return range.min ?? 0
}

export function buildActions(self) {
	const choices = buildChoices(self.model, self.config, {
		channels: buildChannelChoices,
		sends: buildSendChoices,
	})
	const actions = {}

	for (const param of PARAMETERS) {
		// Console-originated values (e.g. total channel gain) have nothing to set.
		if (param.access === 'r') continue

		const fields = scopeFields(param, choices)
		const label = `${param.category}: ${param.name}`

		if (param.kind === 'trigger') {
			actions[param.id] = {
				name: label,
				sortName: sortKey(param),
				description: describe(param),
				options: fields,
				callback: async (event) => {
					self.sendParam(param, event.options, undefined)
				},
			}
			continue
		}

		if (param.kind === 'bool') {
			actions[param.id] = {
				name: label,
				sortName: sortKey(param),
				description: describe(param, 'Toggle needs the console to have reported a value first.'),
				options: [
					...fields,
					{
						id: 'mode',
						type: 'dropdown',
						label: 'Action',
						choices: [
							{ id: 'on', label: 'On' },
							{ id: 'off', label: 'Off' },
							{ id: 'toggle', label: 'Toggle' },
						],
						default: 'toggle',
					},
				],
				learn: (action) => {
					const current = self.getParamValue(param, action.options)
					if (current === undefined) return undefined
					return { mode: current ? 'on' : 'off' }
				},
				callback: async (event) => {
					const mode = event.options.mode
					let target
					if (mode === 'toggle') {
						const current = self.getParamValue(param, event.options)
						if (current === undefined) {
							self.log(
								'warn',
								`Cannot toggle ${param.name}: the console has not reported a value yet. ` +
									`Enable "Request full state on connect", or use On/Off instead.`,
							)
							return
						}
						target = !current
					} else {
						target = mode === 'on'
					}
					self.sendParam(param, event.options, target)
				},
			}
			continue
		}

		// Absolute set - applies to float, int and string.
		// Option values arrive already resolved; API 2.0 parses variables and
		// expressions before the callback runs.
		actions[param.id] = {
			name: label,
			sortName: sortKey(param),
			description: describe(param),
			options: [...fields, valueField(param)],
			learn: learnValue(self, param),
			callback: async (event) => {
				// The cache and the wire both use the console's own units; only the
				// input field is in display units.
				self.sendParam(param, event.options, toWire(param, event.options.value))
			},
		}

		if (param.kind !== 'float' && param.kind !== 'int') continue

		const range = displayRange(param)

		// Relative adjust.
		actions[`${param.id}_delta`] = {
			name: `${label} (adjust by)`,
			sortName: sortKey(param, 1),
			description: describe(param, 'Relative to the last value the console reported.'),
			options: [
				...fields,
				{
					id: 'delta',
					type: 'number',
					label: range.unit ? `Adjust by (${range.unit})` : 'Adjust by',
					default: range.step ?? 1,
					min: -(range.max - range.min),
					max: range.max - range.min,
					step: range.step ?? 1,
				},
			],
			callback: async (event) => {
				const current = self.getParamValue(param, event.options)
				if (current === undefined) {
					self.log(
						'warn',
						`Cannot adjust ${param.name}: the console has not reported a value yet. ` +
							`Enable "Request full state on connect" so relative actions have a starting point.`,
					)
					return
				}
				const delta = toWire(param, event.options.delta ?? 0)
				const next = clampToParam(param, Number(current) + Number(delta))
				self.sendParam(param, event.options, next)
			},
		}

		if (!param.fadeable) continue

		// Timed fade.
		actions[`${param.id}_fade`] = {
			name: `${label} (fade to)`,
			sortName: sortKey(param, 2),
			description: describe(param, 'Ramps from the current value; jumps if the console has not reported one.'),
			options: [
				...fields,
				valueField(param),
				{
					id: 'duration',
					type: 'number',
					label: 'Fade duration (ms)',
					default: 1000,
					min: 0,
					max: 600000,
					step: 100,
				},
			],
			callback: async (event) => {
				self.startFade(param, event.options, toWire(param, event.options.value), Number(event.options.duration ?? 0))
			},
		}
	}

	addUtilityActions(self, actions, choices)
	return actions
}

function clampToParam(param, value) {
	if (param.min === undefined || param.max === undefined) return value
	return Math.max(param.min, Math.min(param.max, value))
}

function addUtilityActions(self, actions, choices) {
	actions.console_request_resend = {
		name: 'Console: Resend all properties',
		sortName: 'zz_resend',
		description: 'Asks the console to push its full parameter set, repopulating feedbacks and variables.',
		options: [],
		callback: async () => {
			self.connection.requestResend()
		},
	}

	const queryable = PARAMETERS.filter((p) => p.kind !== 'trigger')
	const anyOf = (params) =>
		params.length === 0 ? 'false' : params.map((p) => `$(options:parameter) == '${p.id}'`).join(' || ')

	actions.query_parameter = {
		name: 'Console: Query a parameter value',
		sortName: 'zz_query',
		description: 'Sends the OSC address with no arguments, which makes the console reply with its current value.',
		options: [
			{
				id: 'parameter',
				type: 'dropdown',
				label: 'Parameter',
				choices: queryable.map((p) => ({ id: p.id, label: `${p.category}: ${p.name}` })),
				default: queryable[0]?.id ?? '',
				minChoicesForSearch: 0,
				// Referenced by the isVisibleExpression below, which requires it to hold a
				// plain value rather than a possibly-changing expression.
				disableAutoExpression: true,
			},
			{
				...channelField(choices.channels),
				isVisibleExpression: anyOf(queryable.filter((p) => p.scope !== 'global')),
			},
			{
				...bandField(choices.eqBands, 'EQ / dynamics band'),
				isVisibleExpression: anyOf(queryable.filter((p) => p.scope === 'eqband' || p.scope === 'dynband')),
			},
			{
				...sendField(choices.sends),
				isVisibleExpression: anyOf(queryable.filter((p) => p.scope === 'send')),
			},
		],
		callback: async (event) => {
			const param = PARAMETERS.find((p) => p.id === event.options.parameter)
			if (!param) return
			try {
				self.connection.query(pathFromOptions(param, event.options))
			} catch (err) {
				self.log('warn', `Query skipped: ${err.message}`)
			}
		},
	}

	actions.custom_osc = {
		name: 'Console: Send custom OSC command',
		sortName: 'zz_custom',
		description:
			'Escape hatch for addresses this module does not model, or for a console whose OSC addresses ' +
			'have been edited in the OSC Commands editor.',
		options: [
			{
				id: 'address',
				type: 'textinput',
				label: 'OSC address',
				default: '/channel/1/mute',
				useVariables: true,
				regex: '/^\\/.*/',
			},
			{
				id: 'argType',
				type: 'dropdown',
				label: 'Argument type',
				choices: [
					{ id: 'none', label: 'None (queries the current value)' },
					{ id: 'f', label: 'Float' },
					{ id: 'i', label: 'Integer' },
					{ id: 's', label: 'String' },
					{ id: 'T', label: 'Boolean true (OSC type tag)' },
					{ id: 'F', label: 'Boolean false (OSC type tag)' },
				],
				default: 'none',
				// Referenced by the value field's isVisibleExpression below.
				disableAutoExpression: true,
			},
			{
				id: 'argValue',
				type: 'textinput',
				label: 'Argument value',
				default: '',
				useVariables: true,
				isVisibleExpression: "$(options:argType) == 'f' || $(options:argType) == 'i' || $(options:argType) == 's'",
			},
		],
		callback: async (event) => {
			const address = String(event.options.address ?? '').trim()
			if (!address.startsWith('/')) {
				self.log('warn', `Custom OSC skipped: "${address}" is not a valid OSC address`)
				return
			}

			const argType = event.options.argType
			const args = []
			if (argType === 'T' || argType === 'F') {
				args.push({ type: argType })
			} else if (argType === 'f' || argType === 'i' || argType === 's') {
				const raw = String(event.options.argValue ?? '')
				if (argType === 's') {
					args.push({ type: 's', value: raw })
				} else {
					const num = Number(raw)
					if (!Number.isFinite(num)) {
						self.log('warn', `Custom OSC skipped: "${raw}" is not a number`)
						return
					}
					args.push({ type: argType, value: num })
				}
			}

			self.connection.send(address, args)
		},
	}
}
