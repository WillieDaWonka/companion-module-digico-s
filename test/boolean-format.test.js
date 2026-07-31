/**
 * Boolean wire format: the console's exported table says `false/true` (OSC T/F tags), but
 * the earlier module sent the literal strings and reportedly worked. Rather than guess,
 * AUTO adopts whatever the console is heard using.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normaliseConfig } from '../src/config.js'
import { BOOL_FORMAT, boolFormatFromOscType, PARAMETERS_BY_ID } from '../src/constants.js'
import { decodeParamValue, encodeParamArgs } from '../src/values.js'
import { decodePacket, encodeMessage } from '../src/osc-codec.js'

const mute = PARAMETERS_BY_ID.get('mute')

describe('boolean encoding', () => {
	it('emits OSC type tags', () => {
		const config = normaliseConfig({ boolFormat: BOOL_FORMAT.TRUE_FALSE })
		assert.deepEqual(encodeParamArgs(mute, true, config), [{ type: 'T' }])
		assert.deepEqual(encodeParamArgs(mute, false, config), [{ type: 'F' }])
	})

	it('emits the literal strings when asked', () => {
		const config = normaliseConfig({ boolFormat: BOOL_FORMAT.STRING })
		assert.deepEqual(encodeParamArgs(mute, true, config), [{ type: 's', value: 'true' }])
		assert.deepEqual(encodeParamArgs(mute, false, config), [{ type: 's', value: 'false' }])
	})

	it('emits integers when normalised', () => {
		const config = normaliseConfig({ boolFormat: BOOL_FORMAT.INT })
		assert.deepEqual(encodeParamArgs(mute, true, config), [{ type: 'i', value: 1 }])
		assert.deepEqual(encodeParamArgs(mute, false, config), [{ type: 'i', value: 0 }])
	})

	it('every format survives a real OSC round trip', () => {
		for (const format of [BOOL_FORMAT.TRUE_FALSE, BOOL_FORMAT.STRING, BOOL_FORMAT.INT]) {
			const config = normaliseConfig({ boolFormat: format })
			for (const value of [true, false]) {
				const args = encodeParamArgs(mute, value, config)
				const [packet] = decodePacket(encodeMessage('/channel/1/mute', args))
				const raw = packet.args[0].type === 'T' ? true : packet.args[0].type === 'F' ? false : packet.args[0].value
				assert.equal(decodeParamValue(mute, raw, config), value, `${format} / ${value}`)
			}
		}
	})
})

describe('boolean decoding accepts every format regardless of config', () => {
	const config = normaliseConfig({})

	it('reads OSC tags, integers and strings alike', () => {
		for (const truthy of [true, 1, 'true', '1']) {
			assert.equal(decodeParamValue(mute, truthy, config), true, `${truthy}`)
		}
		for (const falsy of [false, 0, 'false', '0']) {
			assert.equal(decodeParamValue(mute, falsy, config), false, `${falsy}`)
		}
	})
})

describe('auto detection', () => {
	it('maps an observed OSC type back to the format that produced it', () => {
		assert.equal(boolFormatFromOscType('T'), BOOL_FORMAT.TRUE_FALSE)
		assert.equal(boolFormatFromOscType('F'), BOOL_FORMAT.TRUE_FALSE)
		assert.equal(boolFormatFromOscType('i'), BOOL_FORMAT.INT)
		assert.equal(boolFormatFromOscType('s'), BOOL_FORMAT.STRING)
	})

	it('ignores types that cannot indicate a boolean format', () => {
		assert.equal(boolFormatFromOscType('f'), undefined)
		assert.equal(boolFormatFromOscType(undefined), undefined)
	})

	it('defaults to auto so a fresh connection adapts on its own', () => {
		assert.equal(normaliseConfig({}).boolFormat, BOOL_FORMAT.AUTO)
	})
})
