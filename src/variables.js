/**
 * Companion variables for the most-used per-channel values, plus connection info.
 *
 * Only a curated set of parameters gets a variable (name, fader, mute, solo). Exposing
 * all ~60 parameters across all ~103 channels would run to thousands of definitions for
 * very little benefit - anything else is reachable through feedbacks.
 */

import { buildChannelDescriptors, PARAMETERS_BY_ID, resolvePath, VARIABLE_PARAMETERS } from './constants.js'
import { formatParamValue } from './values.js'

/** Short suffixes so variables read as `$(desk:input_1_fader)`. */
const SUFFIX = {
	channel_name: 'name',
	fader: 'fader',
	mute: 'mute',
	solo: 'solo',
}

/**
 * Module API 2.0 takes variable definitions as an object keyed by variable id,
 * not the array of `{ variableId, name }` used by earlier versions.
 */
export function buildVariableDefinitions(model) {
	const definitions = {
		connected: { name: 'Console connected (true/false)' },
		console_ip: { name: 'Console IP address' },
		channel_mode: { name: 'Configured channel/bus mode' },
		input_count: { name: 'Input channel count' },
		bus_count: { name: 'Aux/Group bus count' },
		last_snapshot: { name: 'Last snapshot fired' },
		console_channel_counts: { name: 'Channel counts reported by console' },
	}

	for (const channel of buildChannelDescriptors(model)) {
		for (const paramId of VARIABLE_PARAMETERS) {
			const param = PARAMETERS_BY_ID.get(paramId)
			if (!param) continue
			definitions[`${channel.slug}_${SUFFIX[paramId]}`] = {
				name: `${channel.label} - ${param.name}`,
			}
		}
	}

	return definitions
}

/**
 * Map an OSC address plus its channel number to the variable it feeds.
 * @returns {string|undefined} variableId
 */
export function variableIdFor(model, paramId, channelOsc) {
	const suffix = SUFFIX[paramId]
	if (!suffix) return undefined
	const channel = buildChannelDescriptors(model).find((c) => c.osc === channelOsc)
	if (!channel) return undefined
	return `${channel.slug}_${suffix}`
}

/** Initial values so variables are never blank before the console reports anything. */
export function initialVariableValues(config, model) {
	const values = {
		connected: 'false',
		console_ip: config.host || '',
		channel_mode: model.expanded ? '60/24' : '48/16',
		input_count: String(model.inputCount),
		bus_count: String(model.busCount),
		last_snapshot: '',
		console_channel_counts: '',
	}

	for (const channel of buildChannelDescriptors(model)) {
		for (const paramId of VARIABLE_PARAMETERS) {
			values[`${channel.slug}_${SUFFIX[paramId]}`] = ''
		}
	}

	return values
}

/**
 * Build a variable update for a value the console just reported.
 * @returns {Record<string, string>|undefined}
 */
export function variableUpdateFor(model, param, vars, value) {
	if (!VARIABLE_PARAMETERS.includes(param.id)) return undefined
	const variableId = variableIdFor(model, param.id, vars.channel)
	if (!variableId) return undefined
	return { [variableId]: formatParamValue(param, value) }
}

/** Addresses whose values back a variable - used to prime the cache on connect. */
export function variableSourceAddresses(model) {
	const addresses = []
	for (const channel of buildChannelDescriptors(model)) {
		for (const paramId of VARIABLE_PARAMETERS) {
			const param = PARAMETERS_BY_ID.get(paramId)
			if (!param) continue
			addresses.push(resolvePath(param.path, { channel: channel.osc }))
		}
	}
	return addresses
}
