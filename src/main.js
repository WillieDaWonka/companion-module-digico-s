import { InstanceBase } from '@companion-module/base'
import { buildActions } from './actions.js'
import { getConfigFields, normaliseConfig } from './config.js'
import { OscConnection } from './connection.js'
import { ADDRESS, BOOL_FORMAT, boolFormatFromOscType, getChannelModel } from './constants.js'
import { buildFeedbacks } from './feedbacks.js'
import { pathFromOptions } from './fields.js'
import { argToValue } from './osc-codec.js'
import { buildPresets } from './presets.js'
import { startPolling, stopPolling } from './poller.js'
import { ConsoleState } from './state.js'
import { UpgradeScripts } from './upgrades.js'
import { decodeParamValue, encodeParamArgs } from './values.js'
import { buildVariableDefinitions, initialVariableValues, variableUpdateFor } from './variables.js'

/** Feedback rechecks and variable writes are batched at this interval. */
const FLUSH_INTERVAL_MS = 60
/** Fade steps per second - fast enough to sound smooth, slow enough not to flood the desk. */
const FADE_RATE_HZ = 25

export default class DigicoSSeriesInstance extends InstanceBase {
	config = normaliseConfig({})
	model = getChannelModel(undefined)
	state = new ConsoleState()
	connection = new OscConnection(this)

	/** Feedback ids awaiting a recheck, and variable values awaiting a write. */
	#pendingFeedbacks = new Set()
	#pendingVariables = {}
	#flushTimer = null

	/** Running fades, keyed by OSC address, so a new fade supersedes the old one. */
	#fades = new Map()

	/** Boolean wire format observed from the console, used when config is set to AUTO. */
	#detectedBoolFormat = undefined

	/** Periodic /console/resend, so state self-heals without the user doing anything. */
	#pollTimer = null

	/**
	 * The config as the encoder should see it, with AUTO resolved to whatever the console
	 * has actually been heard using.
	 */
	get effectiveConfig() {
		if (this.config.boolFormat !== BOOL_FORMAT.AUTO) return this.config
		return { ...this.config, boolFormat: this.#detectedBoolFormat ?? BOOL_FORMAT.TRUE_FALSE }
	}

	async init(config) {
		this.config = normaliseConfig(config)
		this.model = getChannelModel(this.config.channelMode)

		this.#rebuildDefinitions()
		this.setVariableValues(initialVariableValues(this.config, this.model))

		this.connection.start(this.config)
		this.#restartPolling()
	}

	async destroy() {
		this.#stopAllFades()
		stopPolling(this.#pollTimer)
		this.#pollTimer = null
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer)
			this.#flushTimer = null
		}
		this.connection.stop()
	}

	async configUpdated(config) {
		const previous = this.config
		this.config = normaliseConfig(config)
		this.model = getChannelModel(this.config.channelMode)

		this.#stopAllFades()
		this.state.clear()

		// Channel mode changes the contents of every dropdown, so definitions have to
		// be regenerated rather than just reused.
		this.#rebuildDefinitions()
		this.setVariableValues(initialVariableValues(this.config, this.model))

		const networkChanged =
			previous.host !== this.config.host ||
			previous.consolePort !== this.config.consolePort ||
			previous.localPort !== this.config.localPort

		if (networkChanged || !this.connection.connected) {
			this.connection.start(this.config)
		} else if (this.config.resendOnConnect) {
			this.connection.requestResend()
		}

		// The interval may have changed even when nothing else did.
		this.#restartPolling()
	}

	getConfigFields() {
		return getConfigFields()
	}

	/** (Re)start the periodic /console/resend at the configured interval; see poller.js. */
	#restartPolling() {
		stopPolling(this.#pollTimer)
		this.#pollTimer = startPolling({
			intervalSeconds: this.config.pollIntervalSec,
			isConnected: () => this.connection.connected,
			onTick: () => this.connection.requestResend(),
		})
	}

	#rebuildDefinitions() {
		this.setActionDefinitions(buildActions(this))
		this.setFeedbackDefinitions(buildFeedbacks(this))
		this.setVariableDefinitions(buildVariableDefinitions(this.model))

		const { structure, presets } = buildPresets(this.model)
		this.setPresetDefinitions(structure, presets)
	}

	// --- Transport callbacks -------------------------------------------------

	/** Called by OscConnection when the ping/pong state changes. */
	onConnectionChange(connected, isFirstConnect = false) {
		this.#queueVariable('connected', connected ? 'true' : 'false')
		this.#queueFeedback('connected')

		if (connected && (isFirstConnect || this.state.size === 0) && this.config.resendOnConnect) {
			// Give the desk a beat before asking for a full dump; it answers the ping
			// and the resend burst from the same thread.
			setTimeout(() => this.connection.requestResend(), 250)
		}
		this.#scheduleFlush()
	}

	/** Called by OscConnection for every decoded message that is not a pong. */
	onOscMessage(packet) {
		const { address, args } = packet

		if (address.toLowerCase() === ADDRESS.CHANNEL_COUNTS) {
			const counts = args.map((a) => a.value).join(', ')
			this.#queueVariable('console_channel_counts', counts)
			this.#scheduleFlush()
			return
		}

		const match = this.state.lookup(address)
		if (!match) return

		const { param, vars } = match
		// Triggers (/console/ping, /console/resend) carry no state and have no
		// feedback definition, so there is nothing to record for them.
		if (param.kind === 'trigger') return

		const raw = argToValue(args)
		// A message with no arguments is a query, not a value report.
		if (raw === undefined) return

		if (param.kind === 'bool') this.#noteBoolFormat(args[0]?.type)

		const value = decodeParamValue(param, raw, this.config)
		if (value === undefined) return

		this.state.set(address, value)

		if (param.id === 'snapshot_fire') {
			this.#queueVariable('last_snapshot', String(value))
		}

		const variableUpdate = variableUpdateFor(this.model, param, vars, value)
		if (variableUpdate) Object.assign(this.#pendingVariables, variableUpdate)

		this.#queueFeedback(param.id)
		this.#scheduleFlush()
	}

	/**
	 * Adopt the boolean encoding the console itself uses. Whatever it sends, it accepts,
	 * so this removes the guesswork that would otherwise leave mutes silently not working.
	 */
	#noteBoolFormat(oscType) {
		const format = boolFormatFromOscType(oscType)
		if (!format || format === this.#detectedBoolFormat) return

		this.#detectedBoolFormat = format
		if (this.config.boolFormat === BOOL_FORMAT.AUTO) {
			this.log('info', `Console sends booleans as ${describeBoolFormat(format)}; matching that when sending.`)
		}
	}

	// --- Parameter helpers used by actions and feedbacks ---------------------

	/** Current cached value for a parameter, or undefined if the console has not reported it. */
	getParamValue(param, options) {
		try {
			return this.state.get(pathFromOptions(param, options))
		} catch {
			return undefined
		}
	}

	/** Send a parameter value, or a bare query when `value` is undefined. */
	sendParam(param, options, value) {
		let address
		try {
			address = pathFromOptions(param, options)
		} catch (err) {
			this.log('warn', `${param.name} skipped: ${err.message}`)
			return
		}

		this.#stopFade(address)
		this.#writeParam(param, address, value)
	}

	/** Encode and transmit, then optimistically cache so toggles chain correctly. */
	#writeParam(param, address, value) {
		const args = value === undefined ? [] : encodeParamArgs(param, value, this.effectiveConfig)
		this.connection.send(address, args)

		if (value === undefined) return

		// The console echoes changes back, but not instantly. Caching now keeps a rapid
		// sequence of toggles or relative steps coherent.
		this.state.set(address, value)

		const match = this.state.lookup(address)
		if (match) {
			const variableUpdate = variableUpdateFor(this.model, match.param, match.vars, value)
			if (variableUpdate) Object.assign(this.#pendingVariables, variableUpdate)
		}
		if (param.id === 'snapshot_fire') {
			this.#queueVariable('last_snapshot', String(value))
		}
		this.#queueFeedback(param.id)
		this.#scheduleFlush()
	}

	// --- Fades ---------------------------------------------------------------

	startFade(param, options, target, durationMs) {
		let address
		try {
			address = pathFromOptions(param, options)
		} catch (err) {
			this.log('warn', `${param.name} fade skipped: ${err.message}`)
			return
		}

		if (!Number.isFinite(target)) {
			this.log('warn', `${param.name} fade skipped: target is not a number`)
			return
		}

		this.#stopFade(address)

		const from = Number(this.state.get(address))
		if (!Number.isFinite(from) || !(durationMs > 0)) {
			// Without a known starting point a fade is meaningless - jump instead.
			this.#writeParam(param, address, target)
			return
		}

		const steps = Math.max(1, Math.round((durationMs / 1000) * FADE_RATE_HZ))
		let step = 0

		const timer = setInterval(() => {
			step++
			const progress = step / steps
			const value = step >= steps ? target : from + (target - from) * progress

			this.#writeParam(param, address, value)

			if (step >= steps) this.#stopFade(address)
		}, durationMs / steps)

		this.#fades.set(address, timer)
	}

	#stopFade(address) {
		const timer = this.#fades.get(address)
		if (timer) {
			clearInterval(timer)
			this.#fades.delete(address)
		}
	}

	#stopAllFades() {
		for (const timer of this.#fades.values()) clearInterval(timer)
		this.#fades.clear()
	}

	// --- Batching ------------------------------------------------------------

	#queueVariable(id, value) {
		this.#pendingVariables[id] = value
	}

	#queueFeedback(feedbackId) {
		this.#pendingFeedbacks.add(feedbackId)
	}

	/**
	 * A `/console/resend` burst can carry thousands of messages. Coalescing feedback
	 * rechecks and variable writes into one tick per 60 ms keeps that from stalling
	 * Companion's UI.
	 */
	#scheduleFlush() {
		if (this.#flushTimer) return
		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = null
			this.#flush()
		}, FLUSH_INTERVAL_MS)
	}

	#flush() {
		if (Object.keys(this.#pendingVariables).length > 0) {
			this.setVariableValues(this.#pendingVariables)
			this.#pendingVariables = {}
		}
		if (this.#pendingFeedbacks.size > 0) {
			const ids = [...this.#pendingFeedbacks]
			this.#pendingFeedbacks.clear()
			this.checkFeedbacks(...ids)
		}
	}
}

function describeBoolFormat(format) {
	if (format === BOOL_FORMAT.INT) return 'integer 0/1'
	if (format === BOOL_FORMAT.STRING) return 'the strings "true"/"false"'
	return 'OSC true/false type tags'
}

// Module API 2.0 removed `runEntrypoint`: the host imports this file, constructs the
// default export itself, and reads the upgrade scripts from this named export.
export { UpgradeScripts }
