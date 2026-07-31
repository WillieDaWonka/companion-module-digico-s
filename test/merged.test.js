/**
 * Covers the corrections merged in after comparing against the earlier
 * WillieDaWonka/companion-module-digico-s attempt.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildActions } from '../src/actions.js'
import { normaliseConfig } from '../src/config.js'
import {
	BAND_BASE,
	buildDynBandChoices,
	buildEqBandChoices,
	buildSendChoices,
	CHANNEL_MODE,
	getChannelModel,
	PARAMETERS_BY_ID,
} from '../src/constants.js'
import { buildFeedbacks } from '../src/feedbacks.js'
import { displayRange, toDisplay, toWire } from '../src/values.js'

function makeSelf(overrides = {}) {
	const config = normaliseConfig(overrides)
	return {
		model: getChannelModel(config.channelMode),
		config,
		connection: { connected: true, send() {}, query() {}, requestResend() {} },
		log() {},
		getParamValue: () => undefined,
		sendParam() {},
		startFade() {},
	}
}

describe('send destinations are bus OSC numbers', () => {
	const model = getChannelModel(CHANNEL_MODE.EXPANDED)

	it('offers busses, not 1..24 slot indices', () => {
		const ids = buildSendChoices(model).map((c) => c.id)
		assert.ok(ids.includes(70), 'Aux 1 should be OSC 70')
		assert.ok(ids.includes(93), 'top Group should be OSC 93')
		assert.ok(!ids.includes(1), 'a bare slot index 1 is not a valid destination')
	})

	it('includes control groups and the master bus, which have no aux-send slot', () => {
		const ids = buildSendChoices(model).map((c) => c.id)
		assert.ok(ids.includes(110), 'control groups must be assignable')
		assert.ok(ids.includes(119))
		assert.ok(ids.includes(120), 'master bus must be assignable')
	})

	it('excludes input channels as destinations', () => {
		const ids = buildSendChoices(model).map((c) => c.id)
		for (const input of [1, 30, 60]) {
			assert.ok(!ids.includes(input), `input ${input} is not a send destination`)
		}
	})

	it('shrinks with the console mode', () => {
		const ids = buildSendChoices(getChannelModel(CHANNEL_MODE.STANDARD)).map((c) => c.id)
		assert.ok(!ids.includes(93))
		assert.ok(ids.includes(85))
	})
})

describe('band numbering', () => {
	it('defaults to zero-based, matching DiGiCo documentation', () => {
		assert.deepEqual(
			buildEqBandChoices(BAND_BASE.ZERO).map((c) => c.id),
			[0, 1, 2, 3],
		)
		assert.deepEqual(
			buildDynBandChoices(BAND_BASE.ZERO).map((c) => c.id),
			[0, 1, 2],
		)
	})

	it('can be switched to one-based', () => {
		assert.deepEqual(
			buildEqBandChoices(BAND_BASE.ONE).map((c) => c.id),
			[1, 2, 3, 4],
		)
		assert.deepEqual(
			buildDynBandChoices(BAND_BASE.ONE).map((c) => c.id),
			[1, 2, 3],
		)
	})

	it('keeps labels stable so only the wire index changes', () => {
		const zero = buildEqBandChoices(BAND_BASE.ZERO).map((c) => c.label)
		const one = buildEqBandChoices(BAND_BASE.ONE).map((c) => c.label)
		assert.deepEqual(zero, one)
	})

	it('flows through to the generated action dropdowns', () => {
		const oneBased = buildActions(makeSelf({ bandBase: BAND_BASE.ONE })).eq_band_gain
		const bandOption = oneBased.options.find((o) => o.id === 'band')
		assert.deepEqual(
			bandOption.choices.map((c) => c.id),
			[1, 2, 3, 4],
		)
	})
})

describe('millisecond display for sub-second times', () => {
	const attack = PARAMETERS_BY_ID.get('dyn1_attack')
	const delay = PARAMETERS_BY_ID.get('input_delay_time')

	it('converts display milliseconds to wire seconds', () => {
		assert.equal(toWire(attack, 10), 0.01)
		assert.equal(toWire(delay, 682), 0.682)
	})

	it('converts wire seconds back to display milliseconds', () => {
		assert.equal(toDisplay(attack, 0.0005), 0.5)
		assert.equal(toDisplay(delay, 0.25), 250)
	})

	it('presents the range in milliseconds without float noise', () => {
		const range = displayRange(attack)
		assert.equal(range.unit, 'ms')
		assert.equal(range.min, 0.5)
		assert.equal(range.max, 100)
		assert.equal(range.step, 0.5)
	})

	it('leaves parameters without a display block untouched', () => {
		const fader = PARAMETERS_BY_ID.get('fader')
		assert.equal(toWire(fader, -12.5), -12.5)
		assert.equal(toDisplay(fader, -12.5), -12.5)
		assert.deepEqual(displayRange(fader), { min: -90, max: 10, step: 0.5, unit: 'dB' })
	})

	it('labels the action field in milliseconds', () => {
		const action = buildActions(makeSelf()).dyn1_attack
		const value = action.options.find((o) => o.id === 'value')
		assert.match(value.label, /ms/)
		assert.equal(value.min, 0.5)
		assert.equal(value.max, 100)
	})

	it('labels the feedback comparison field in milliseconds too', () => {
		const feedback = buildFeedbacks(makeSelf()).dyn1_attack
		const value = feedback.options.find((o) => o.id === 'value')
		assert.match(value.label, /ms/)
		assert.equal(value.max, 100)
	})

	it('gives every millisecond parameter a sane, non-zero step', () => {
		for (const param of PARAMETERS_BY_ID.values()) {
			if (!param.display) continue
			const range = displayRange(param)
			assert.ok(range.step > 0, `${param.id} step must be positive`)
			assert.ok(range.max > range.min, `${param.id} range must be ordered`)
			// A step finer than the range would make the field unusable.
			assert.ok(range.step <= range.max - range.min, `${param.id} step too coarse`)
		}
	})
})

describe('facts confirmed against the earlier attempt', () => {
	it('keeps EQ band gain at +/-18 dB, not the exported table 18..18', () => {
		const param = PARAMETERS_BY_ID.get('eq_band_gain')
		assert.equal(param.min, -18)
		assert.equal(param.max, 18)
	})

	it('keeps DiGiTube under the input path', () => {
		assert.equal(PARAMETERS_BY_ID.get('digitube_bias').path, '/channel/{channel}/input/digitube/bias')
		assert.equal(PARAMETERS_BY_ID.get('digitube_drive').path, '/channel/{channel}/input/digitube/drive')
	})

	it('models dynamics 1 with three bands', () => {
		assert.equal(buildDynBandChoices(BAND_BASE.ZERO).length, 3)
	})
})
