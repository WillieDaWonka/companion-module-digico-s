/**
 * Translation between real-world parameter values (dB, Hz, seconds) and the OSC
 * argument types the console is currently configured to speak.
 *
 * The S-Series OSC Commands editor lets an operator globally "normalise" the command
 * set, which rescales every continuous range to 0.0..1.0 and swaps the boolean `T`/`F`
 * type tags for integer 0/1. Both variants are handled here so the rest of the module
 * only ever deals in real units.
 */

import { BOOL_FORMAT } from './constants.js'

function clamp(value, min, max) {
	if (min === undefined || max === undefined) return value
	return Math.max(min, Math.min(max, value))
}

/** Trim the float noise that multiplying by 1000 introduces (0.0005 -> 0.5, not 0.5000000000000001). */
function tidy(value) {
	return Number(value.toPrecision(12))
}

/**
 * Sub-second times are held in seconds on the wire, because that is what the console
 * uses, but entering `0.0005` for an attack is hostile. Such parameters carry a
 * `display` block and are shown in milliseconds instead.
 */
export function toWire(param, displayValue) {
	const num = Number(displayValue)
	if (!param.display || !Number.isFinite(num)) return num
	return tidy(num / param.display.scale)
}

export function toDisplay(param, wireValue) {
	const num = Number(wireValue)
	if (!param.display || !Number.isFinite(num)) return num
	return tidy(num * param.display.scale)
}

/** Min/max/step/unit for an input field, in whichever units the user sees. */
export function displayRange(param) {
	if (!param.display) {
		return { min: param.min, max: param.max, step: param.step, unit: param.unit }
	}
	const { scale, unit } = param.display
	return {
		min: param.min === undefined ? undefined : tidy(param.min * scale),
		max: param.max === undefined ? undefined : tidy(param.max * scale),
		step: param.step === undefined ? undefined : tidy(param.step * scale),
		unit,
	}
}

/** Build the OSC argument list for setting `param` to `value`. */
export function encodeParamArgs(param, value, config) {
	switch (param.kind) {
		case 'trigger':
			return []

		case 'bool': {
			const on = value === true || value === 1 || value === '1' || value === 'true'
			switch (config.boolFormat) {
				case BOOL_FORMAT.INT:
					return [{ type: 'i', value: on ? 1 : 0 }]
				case BOOL_FORMAT.STRING:
					return [{ type: 's', value: on ? 'true' : 'false' }]
				default:
					// AUTO resolves to a concrete format before reaching here.
					return [{ type: on ? 'T' : 'F' }]
			}
		}

		case 'string':
			return [{ type: 's', value: String(value ?? '') }]

		case 'int': {
			const raw = clamp(Number(value) || 0, param.min, param.max)
			// Integers are enumerations (mode, knee, polarity); normalisation does not
			// apply to them, only to continuous ranges.
			return [{ type: 'i', value: Math.round(raw) }]
		}

		case 'float':
		default: {
			const raw = clamp(Number(value) || 0, param.min, param.max)
			if (config.normalise && param.min !== undefined && param.max !== undefined && param.max !== param.min) {
				return [{ type: 'f', value: (raw - param.min) / (param.max - param.min) }]
			}
			return [{ type: 'f', value: raw }]
		}
	}
}

/** Convert a value received from the console into real units. */
export function decodeParamValue(param, raw, config) {
	if (raw === undefined || raw === null) return undefined

	switch (param.kind) {
		case 'bool':
			if (typeof raw === 'boolean') return raw
			if (typeof raw === 'number') return raw !== 0
			if (typeof raw === 'string') return raw === 'true' || raw === '1'
			return Boolean(raw)

		case 'string':
			return String(raw)

		case 'int':
			return Math.round(Number(raw))

		case 'float':
		default: {
			const num = Number(raw)
			if (!Number.isFinite(num)) return undefined
			if (config.normalise && param.min !== undefined && param.max !== undefined && param.max !== param.min) {
				return param.min + num * (param.max - param.min)
			}
			return num
		}
	}
}

/** Format a value for display in a Companion variable. */
export function formatParamValue(param, value) {
	if (value === undefined || value === null) return ''

	switch (param.kind) {
		case 'bool':
			return value ? 'true' : 'false'

		case 'string':
			return String(value)

		case 'int':
			return String(value)

		case 'float':
		default: {
			const num = Number(value)
			if (!Number.isFinite(num)) return ''
			if (param.negativeInfinityAtMin && num <= param.min) return '-inf'
			// Sub-second times need more precision than levels do.
			const decimals = param.unit === 's' ? 4 : Math.abs(num) < 10 ? 2 : 1
			return num.toFixed(decimals).replace(/\.?0+$/, '') || '0'
		}
	}
}
