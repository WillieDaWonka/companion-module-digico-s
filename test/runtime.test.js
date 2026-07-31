/**
 * Exercises the message-handling path without a live console, by driving the
 * instance's callbacks directly with the packets a desk would send.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normaliseConfig } from '../src/config.js'
import { CHANNEL_MODE, getChannelModel, PARAMETERS_BY_ID } from '../src/constants.js'
import { buildFeedbacks } from '../src/feedbacks.js'
import { ConsoleState } from '../src/state.js'
import { decodeParamValue } from '../src/values.js'
import { variableUpdateFor } from '../src/variables.js'

/**
 * Reproduces the relevant half of `onOscMessage` so the attribution -> decode ->
 * cache -> variable pipeline can be asserted end to end.
 */
function ingest(state, config, model, address, raw) {
	const match = state.lookup(address)
	if (!match) return { handled: false }
	const { param, vars } = match
	if (param.kind === 'trigger') return { handled: false, reason: 'trigger' }
	if (raw === undefined) return { handled: false, reason: 'query' }

	const value = decodeParamValue(param, raw, config)
	if (value === undefined) return { handled: false }
	state.set(address, value)
	return { handled: true, param, value, variables: variableUpdateFor(model, param, vars, value) }
}

const config = normaliseConfig({})
const model = getChannelModel(CHANNEL_MODE.EXPANDED)

describe('incoming message handling', () => {
	it('caches a fader level and updates the matching variable', () => {
		const state = new ConsoleState()
		const result = ingest(state, config, model, '/channel/1/input/fader', -12.5)
		assert.equal(result.handled, true)
		assert.equal(result.value, -12.5)
		assert.deepEqual(result.variables, { input_1_fader: '-12.5' })
		assert.equal(state.get('/channel/1/input/fader'), -12.5)
	})

	it('maps a bus OSC number onto its aux/group variable slug', () => {
		const state = new ConsoleState()
		assert.deepEqual(ingest(state, config, model, '/channel/70/mute', true).variables, { aux_1_mute: 'true' })
		assert.deepEqual(ingest(state, config, model, '/channel/80/mute', false).variables, { group_1_mute: 'false' })
		assert.deepEqual(ingest(state, config, model, '/channel/120/solo', true).variables, { master_solo: 'true' })
	})

	it('shows a fader at minimum as -inf', () => {
		const state = new ConsoleState()
		assert.deepEqual(ingest(state, config, model, '/channel/2/input/fader', -150).variables, {
			input_2_fader: '-inf',
		})
	})

	it('stores a channel name', () => {
		const state = new ConsoleState()
		const result = ingest(state, config, model, '/channel/3/input/name', 'Kick In')
		assert.deepEqual(result.variables, { input_3_name: 'Kick In' })
	})

	it('ignores triggers and argument-less queries', () => {
		const state = new ConsoleState()
		assert.equal(ingest(state, config, model, '/console/resend', 1).reason, 'trigger')
		assert.equal(ingest(state, config, model, '/channel/1/mute', undefined).reason, 'query')
	})

	it('does not record parameters it has no feedback for', () => {
		// Guards the checkFeedbacks path: every id the pipeline emits must exist.
		const self = {
			model,
			config,
			connection: { connected: true },
			getParamValue: () => undefined,
			log() {},
		}
		const feedbacks = buildFeedbacks(self)
		const state = new ConsoleState()
		for (const address of ['/channel/1/mute', '/channel/1/total/gain', '/channel/1/eq/2/gain']) {
			const result = ingest(state, config, model, address, 1)
			if (!result.handled) continue
			assert.ok(feedbacks[result.param.id], `no feedback exists for ${result.param.id}`)
		}
	})
})

describe('read-only parameters', () => {
	it('still populates from the console', () => {
		const state = new ConsoleState()
		const result = ingest(state, config, model, '/channel/5/total/gain', 6.5)
		assert.equal(result.handled, true)
		assert.equal(PARAMETERS_BY_ID.get('total_gain').access, 'r')
		assert.equal(state.get('/channel/5/total/gain'), 6.5)
	})
})
