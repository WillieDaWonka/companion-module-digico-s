/**
 * Cache of console-reported values, plus the reverse lookup that attributes an
 * incoming OSC address back to the parameter definition it belongs to.
 *
 * `/console/resend` makes the desk push its entire parameter set in one burst, so
 * attribution has to be cheap. Every address is reduced to a "shape" - each numeric
 * segment replaced by `#` - which turns matching into a single Map lookup instead of a
 * scan over ~60 regexes.
 */

import { PARAMETERS } from './constants.js'

const NUMERIC_SEGMENT = /^-?\d+(\.\d+)?$/

/** `/channel/12/eq/2/gain` -> `{ shape: '/channel/#/eq/#/gain', numbers: [12, 2] }` */
function shapeOf(address) {
	const numbers = []
	const shape = address
		.toLowerCase()
		.split('/')
		.map((segment) => {
			if (NUMERIC_SEGMENT.test(segment)) {
				numbers.push(Number(segment))
				return '#'
			}
			return segment
		})
		.join('/')
	return { shape, numbers }
}

/** `/channel/{channel}/eq/{band}/gain` -> `{ shape, varNames: ['channel', 'band'] }` */
function shapeOfTemplate(template) {
	const varNames = []
	const shape = template
		.toLowerCase()
		.split('/')
		.map((segment) => {
			const match = /^\{(\w+)\}$/.exec(segment)
			if (match) {
				varNames.push(match[1])
				return '#'
			}
			return segment
		})
		.join('/')
	return { shape, varNames }
}

export class ConsoleState {
	/** address (lowercased) -> decoded value in real units */
	#values = new Map()
	/** shape -> { param, varNames } */
	#shapes = new Map()

	constructor() {
		for (const param of PARAMETERS) {
			const { shape, varNames } = shapeOfTemplate(param.path)
			this.#shapes.set(shape, { param, varNames })
		}
	}

	/**
	 * Attribute an OSC address to a parameter.
	 * @returns {{param: object, vars: Record<string, number>}|undefined}
	 */
	lookup(address) {
		const { shape, numbers } = shapeOf(address)
		const entry = this.#shapes.get(shape)
		if (!entry) return undefined

		const vars = {}
		entry.varNames.forEach((name, index) => {
			vars[name] = numbers[index]
		})
		return { param: entry.param, vars }
	}

	set(address, value) {
		this.#values.set(address.toLowerCase(), value)
	}

	get(address) {
		return this.#values.get(address.toLowerCase())
	}

	has(address) {
		return this.#values.has(address.toLowerCase())
	}

	clear() {
		this.#values.clear()
	}

	get size() {
		return this.#values.size
	}
}
