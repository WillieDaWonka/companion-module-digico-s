import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildActions } from '../src/actions.js'
import { normaliseConfig } from '../src/config.js'
import { CHANNEL_MODE, getChannelModel, PARAMETERS, PARAMETERS_BY_ID } from '../src/constants.js'
import { buildFeedbacks } from '../src/feedbacks.js'

function makeSelf(cached = {}) {
	const config = normaliseConfig({})
	return {
		model: getChannelModel(CHANNEL_MODE.EXPANDED),
		config,
		connection: { connected: true, send() {}, query() {}, requestResend() {} },
		log() {},
		getParamValue: (param) => cached[param.id],
		sendParam() {},
		startFade() {},
	}
}

describe('fader and send travel', () => {
	it('runs -90 to +10 dB', () => {
		for (const id of ['fader', 'send_level']) {
			const param = PARAMETERS_BY_ID.get(id)
			assert.equal(param.min, -90, `${id} min`)
			assert.equal(param.max, 10, `${id} max`)
		}
	})

	it('shows the bottom of travel as -inf and offers a slider', () => {
		const value = buildActions(makeSelf()).fader.options.find((o) => o.id === 'value')
		assert.equal(value.showMinAsNegativeInfinity, true)
		assert.equal(value.range, true)
		assert.equal(value.min, -90)
		assert.equal(value.max, 10)
	})

	it('clamps out-of-range values to the travel', () => {
		const value = buildActions(makeSelf()).send_level.options.find((o) => o.id === 'value')
		assert.equal(value.clampValues, true)
	})
})

describe('picker presentation', () => {
	const actions = buildActions(makeSelf())
	const feedbacks = buildFeedbacks(makeSelf())

	it('gives every action a sort key so related entries stay together', () => {
		for (const [id, def] of Object.entries(actions)) {
			assert.ok(def.sortName, `${id} has no sortName`)
		}
	})

	it('orders a parameter as set, then adjust, then fade', () => {
		assert.ok(actions.fader.sortName < actions.fader_delta.sortName)
		assert.ok(actions.fader_delta.sortName < actions.fader_fade.sortName)
	})

	it('sorts channel actions ahead of console utilities', () => {
		assert.ok(actions.mute.sortName < actions.custom_osc.sortName)
		assert.ok(actions.fader.sortName < actions.snapshot_next.sortName)
	})

	it('names the OSC address in every parameter action description', () => {
		for (const param of PARAMETERS) {
			if (param.access === 'r') continue
			assert.ok(actions[param.id].description?.includes(param.path), `${param.id} description lacks its address`)
		}
	})

	it('names the OSC address in feedback descriptions too', () => {
		for (const param of PARAMETERS) {
			if (param.kind === 'trigger') continue
			assert.ok(feedbacks[param.id].description?.includes(param.path), `${param.id} feedback lacks its address`)
		}
	})
})

describe('learn', () => {
	it('fills a numeric action from the cached console value', () => {
		const action = buildActions(makeSelf({ fader: -12.5 })).fader
		assert.deepEqual(action.learn({ options: { channel: 1 } }), { value: -12.5 })
	})

	it('reports millisecond parameters in display units', () => {
		const action = buildActions(makeSelf({ dyn1_attack: 0.01 })).dyn1_attack
		assert.deepEqual(action.learn({ options: { channel: 1, band: 0 } }), { value: 10 })
	})

	it('fills a boolean action as on or off rather than toggle', () => {
		assert.deepEqual(buildActions(makeSelf({ mute: true })).mute.learn({ options: { channel: 1 } }), { mode: 'on' })
		assert.deepEqual(buildActions(makeSelf({ mute: false })).mute.learn({ options: { channel: 1 } }), { mode: 'off' })
	})

	it('returns nothing when the console has not reported a value', () => {
		assert.equal(buildActions(makeSelf()).fader.learn({ options: { channel: 1 } }), undefined)
		assert.equal(buildActions(makeSelf()).mute.learn({ options: { channel: 1 } }), undefined)
	})

	it('only returns the learned key, so other options keep their expressions', () => {
		const learned = buildActions(makeSelf({ fader: -6 })).fader.learn({ options: { channel: 1 } })
		assert.deepEqual(Object.keys(learned), ['value'])
	})
})

describe('conditional option visibility', () => {
	const actions = buildActions(makeSelf())

	it('hides band and send on the query action until a relevant parameter is picked', () => {
		const byId = Object.fromEntries(actions.query_parameter.options.map((o) => [o.id, o]))
		assert.ok(byId.band.isVisibleExpression.includes('eq_band_gain'))
		assert.ok(!byId.band.isVisibleExpression.includes("'mute'"))
		assert.ok(byId.send.isVisibleExpression.includes('send_level'))
		assert.ok(byId.channel.isVisibleExpression.includes('mute'))
	})

	it('marks fields referenced by an expression as non-expression, as the API requires', () => {
		const parameter = actions.query_parameter.options.find((o) => o.id === 'parameter')
		assert.equal(parameter.disableAutoExpression, true)
		const argType = actions.custom_osc.options.find((o) => o.id === 'argType')
		assert.equal(argType.disableAutoExpression, true)
	})

	it('lets the query action reach read-only parameters', () => {
		const parameter = actions.query_parameter.options.find((o) => o.id === 'parameter')
		assert.ok(
			parameter.choices.some((c) => c.id === 'total_gain'),
			'total gain is read-only but still worth querying',
		)
	})
})
