import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildActions } from '../src/actions.js'
import { normaliseConfig } from '../src/config.js'
import { BOOL_FORMAT, CHANNEL_MODE, getChannelModel, PARAMETERS, resolvePath } from '../src/constants.js'
import { buildFeedbacks } from '../src/feedbacks.js'
import { pathFromOptions } from '../src/fields.js'
import { buildPresets } from '../src/presets.js'
import { ConsoleState } from '../src/state.js'
import { decodeParamValue, encodeParamArgs } from '../src/values.js'
import { buildVariableDefinitions, initialVariableValues } from '../src/variables.js'

/** Minimal stand-in for the instance surface that actions/feedbacks touch. */
function makeSelf(mode = CHANNEL_MODE.EXPANDED) {
	return {
		model: getChannelModel(mode),
		config: normaliseConfig({ channelMode: mode }),
		connection: { connected: true, send() {}, query() {}, requestResend() {} },
		log() {},
		getParamValue: () => undefined,
		sendParam() {},
		startFade() {},
	}
}

describe('channel model', () => {
	it('exposes 60 inputs and busses up to OSC 93 when upgraded', () => {
		const model = getChannelModel(CHANNEL_MODE.EXPANDED)
		assert.equal(model.inputs.last, 60)
		assert.equal(model.busCount, 24)
		assert.equal(model.groups.last, 93)
	})

	it('drops inputs 49-60 and busses 17-24 on a standard console', () => {
		const model = getChannelModel(CHANNEL_MODE.STANDARD)
		assert.equal(model.inputs.last, 48)
		assert.equal(model.busCount, 16)
		// Busses 17-24 are OSC 86-93, so the top group slot becomes 85.
		assert.equal(model.groups.last, 85)
		assert.equal(model.aux.last, 79)
	})
})

describe('address resolution', () => {
	it('fills channel, band and send placeholders', () => {
		assert.equal(resolvePath('/channel/{channel}/eq/{band}/gain', { channel: 2, band: 3 }), '/channel/2/eq/3/gain')
		assert.equal(
			resolvePath('/channel/{channel}/send/{send}/level', { channel: 7, send: 4 }),
			'/channel/7/send/4/level',
		)
	})

	it('matches the example given in the console help text', () => {
		// "the last (4th) EQ Band Gain control on the second Input Channel" -> band index 3
		const param = PARAMETERS.find((p) => p.id === 'eq_band_gain')
		assert.equal(pathFromOptions(param, { channel: 2, band: 3 }), '/channel/2/eq/3/gain')
	})

	it('addresses a send by the destination bus OSC number', () => {
		// /channel/{source}/send/{destination}/... - this is what makes the same command
		// serve as both "aux send on" and "group assign".
		const param = PARAMETERS.find((p) => p.id === 'send_enabled')
		assert.equal(pathFromOptions(param, { channel: 5, send: 80 }), '/channel/5/send/80/enabled')
	})

	it('refuses a non-numeric channel instead of building a broken address', () => {
		const param = PARAMETERS.find((p) => p.id === 'mute')
		assert.throws(() => pathFromOptions(param, { channel: 'abc' }), /invalid channel/)
	})
})

describe('value encoding', () => {
	const param = PARAMETERS.find((p) => p.id === 'mute')
	const fader = PARAMETERS.find((p) => p.id === 'fader')

	it('uses T/F tags by default', () => {
		const config = normaliseConfig({})
		assert.deepEqual(encodeParamArgs(param, true, config), [{ type: 'T' }])
		assert.deepEqual(encodeParamArgs(param, false, config), [{ type: 'F' }])
	})

	it('uses integers when the console is set to normalised booleans', () => {
		const config = normaliseConfig({ boolFormat: BOOL_FORMAT.INT })
		assert.deepEqual(encodeParamArgs(param, true, config), [{ type: 'i', value: 1 }])
		assert.deepEqual(encodeParamArgs(param, false, config), [{ type: 'i', value: 0 }])
	})

	it('clamps a value to the parameter range', () => {
		const config = normaliseConfig({})
		assert.deepEqual(encodeParamArgs(fader, 999, config), [{ type: 'f', value: 10 }])
		assert.deepEqual(encodeParamArgs(fader, -999, config), [{ type: 'f', value: -90 }])
	})

	it('round-trips through normalisation', () => {
		const config = normaliseConfig({ normalise: true })
		const [arg] = encodeParamArgs(fader, -70, config)
		assert.ok(arg.value >= 0 && arg.value <= 1)
		assert.ok(Math.abs(decodeParamValue(fader, arg.value, config) - -70) < 0.001)
	})

	it('decodes booleans sent as either tags or integers', () => {
		const config = normaliseConfig({})
		assert.equal(decodeParamValue(param, true, config), true)
		assert.equal(decodeParamValue(param, 1, config), true)
		assert.equal(decodeParamValue(param, 0, config), false)
	})
})

describe('state attribution', () => {
	const state = new ConsoleState()

	it('attributes a channel address to its parameter', () => {
		const match = state.lookup('/channel/12/mute')
		assert.equal(match.param.id, 'mute')
		assert.equal(match.vars.channel, 12)
	})

	it('attributes a banded address and extracts both indices', () => {
		const match = state.lookup('/channel/5/eq/2/frequency')
		assert.equal(match.param.id, 'eq_band_frequency')
		assert.equal(match.vars.channel, 5)
		assert.equal(match.vars.band, 2)
	})

	it('attributes a send address', () => {
		const match = state.lookup('/channel/3/send/7/level')
		assert.equal(match.param.id, 'send_level')
		assert.equal(match.vars.channel, 3)
		assert.equal(match.vars.send, 7)
	})

	it('matches case-insensitively, as the console help mixes cases', () => {
		const match = state.lookup('/Channel/2/EQ/3/gain')
		assert.equal(match.param.id, 'eq_band_gain')
		assert.equal(match.vars.band, 3)
	})

	it('ignores an address it does not model', () => {
		assert.equal(state.lookup('/something/else'), undefined)
	})
})

describe('definitions', () => {
	const self = makeSelf()

	it('generates an action for every writable parameter', () => {
		const actions = buildActions(self)
		for (const param of PARAMETERS) {
			if (param.access === 'r') continue
			assert.ok(actions[param.id], `missing action for ${param.id}`)
		}
	})

	it('does not generate an action for a console-originated parameter', () => {
		const actions = buildActions(self)
		assert.equal(actions.total_gain, undefined)
	})

	it('generates relative and fade variants where they make sense', () => {
		const actions = buildActions(self)
		assert.ok(actions.fader_delta)
		assert.ok(actions.fader_fade)
		assert.ok(actions.send_level_fade)
		// A boolean has neither.
		assert.equal(actions.mute_delta, undefined)
		assert.equal(actions.mute_fade, undefined)
	})

	it('includes the custom OSC escape hatch', () => {
		const actions = buildActions(self)
		assert.ok(actions.custom_osc)
		assert.ok(actions.query_parameter)
	})

	it('generates a feedback for every non-trigger parameter, including read-only ones', () => {
		const feedbacks = buildFeedbacks(self)
		assert.ok(feedbacks.total_gain, 'read-only parameters should still be observable')
		for (const param of PARAMETERS) {
			if (param.kind === 'trigger') continue
			assert.ok(feedbacks[param.id], `missing feedback for ${param.id}`)
		}
	})

	it('every action and feedback option has a default', () => {
		for (const definitions of [buildActions(self), buildFeedbacks(self)]) {
			for (const [id, def] of Object.entries(definitions)) {
				for (const option of def.options) {
					if (option.type === 'static-text') continue
					assert.notEqual(option.default, undefined, `${id}.${option.id} has no default`)
				}
			}
		}
	})

	it('scales dropdowns to the configured channel mode', () => {
		const expanded = buildActions(makeSelf(CHANNEL_MODE.EXPANDED)).mute.options[0].choices
		const standard = buildActions(makeSelf(CHANNEL_MODE.STANDARD)).mute.options[0].choices
		assert.ok(
			expanded.some((c) => c.id === 60),
			'expanded should offer input 60',
		)
		assert.ok(!standard.some((c) => c.id === 60), 'standard should not offer input 60')
		assert.ok(
			expanded.some((c) => c.id === 93),
			'expanded should offer OSC 93',
		)
		assert.ok(!standard.some((c) => c.id === 93), 'standard should not offer OSC 93')
	})
})

describe('variables and presets', () => {
	it('defines variables using readable slugs', () => {
		const definitions = buildVariableDefinitions(getChannelModel(CHANNEL_MODE.EXPANDED))
		for (const id of ['input_1_fader', 'aux_1_mute', 'group_14_name', 'master_solo', 'connected']) {
			assert.ok(definitions[id], `missing variable ${id}`)
		}
	})

	it('returns variable definitions as an object keyed by id, as API 2.0 requires', () => {
		const definitions = buildVariableDefinitions(getChannelModel(CHANNEL_MODE.STANDARD))
		assert.ok(!Array.isArray(definitions))
		for (const [id, definition] of Object.entries(definitions)) {
			assert.equal(typeof definition.name, 'string', `${id} needs a name`)
			assert.equal(definition.variableId, undefined, `${id} should not carry a variableId field`)
		}
	})

	it('defines a value for every declared variable', () => {
		const model = getChannelModel(CHANNEL_MODE.EXPANDED)
		const definitions = buildVariableDefinitions(model)
		const values = initialVariableValues(normaliseConfig({}), model)
		for (const id of Object.keys(definitions)) {
			assert.notEqual(values[id], undefined, `${id} has no initial value`)
		}
	})

	it('builds presets whose every structure reference resolves', () => {
		const { structure, presets } = buildPresets(getChannelModel(CHANNEL_MODE.EXPANDED))
		const referenced = []
		for (const section of structure) {
			for (const entry of section.definitions) {
				if (typeof entry === 'string') referenced.push(entry)
				else referenced.push(...entry.presets)
			}
		}
		assert.ok(referenced.length > 0)
		for (const id of referenced) {
			assert.ok(presets[id], `structure references missing preset ${id}`)
		}
	})

	it('uses real newlines and the module-id variable prefix in button text', () => {
		const { presets } = buildPresets(getChannelModel(CHANNEL_MODE.EXPANDED))
		const manifestId = 'digico-s-series'
		for (const [id, preset] of Object.entries(presets)) {
			const text = preset.style.text
			assert.ok(!text.includes('\\n'), `${id} has a literal backslash-n in its text`)
			for (const match of text.matchAll(/\$\(([^:]+):/g)) {
				assert.equal(match[1], manifestId, `${id} references variables with the wrong prefix`)
			}
		}
	})

	it('references only variables that are actually defined', () => {
		const model = getChannelModel(CHANNEL_MODE.EXPANDED)
		const { presets } = buildPresets(model)
		const defined = buildVariableDefinitions(model)
		for (const [id, preset] of Object.entries(presets)) {
			for (const match of preset.style.text.matchAll(/\$\([^:]+:([^)]+)\)/g)) {
				assert.ok(defined[match[1]], `${id} references undefined variable ${match[1]}`)
			}
		}
	})

	it('gives every preset and preset group a unique id', () => {
		const { structure, presets } = buildPresets(getChannelModel(CHANNEL_MODE.EXPANDED))
		const seen = new Set(Object.keys(presets))
		for (const section of structure) {
			assert.ok(!seen.has(section.id), `section id ${section.id} collides`)
			seen.add(section.id)
			for (const entry of section.definitions) {
				if (typeof entry === 'string') continue
				assert.ok(!seen.has(entry.id), `group id ${entry.id} collides`)
				seen.add(entry.id)
			}
		}
	})

	it('only references actions and feedbacks that exist', () => {
		const self = makeSelf()
		const actions = buildActions(self)
		const feedbacks = buildFeedbacks(self)
		const { presets } = buildPresets(self.model)

		for (const [id, preset] of Object.entries(presets)) {
			for (const step of preset.steps) {
				for (const list of Object.values(step)) {
					if (!Array.isArray(list)) continue
					for (const action of list) {
						assert.ok(actions[action.actionId], `${id} uses unknown action ${action.actionId}`)
					}
				}
			}
			for (const feedback of preset.feedbacks) {
				assert.ok(feedbacks[feedback.feedbackId], `${id} uses unknown feedback ${feedback.feedbackId}`)
			}
		}
	})
})
