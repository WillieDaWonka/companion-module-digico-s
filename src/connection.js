/**
 * Bidirectional OSC/UDP transport to an S-Series console.
 *
 * The console is a peer, not a server: it listens on its own configurable receive port
 * and pushes changes to whichever controller is registered in
 * Extensions > OSC Control. There is no session to establish, so liveness is inferred
 * from the documented `/console/ping` -> `/console/pong` exchange.
 */

import { InstanceStatus } from '@companion-module/base'
import { decodePacket, encodeMessage } from './osc-codec.js'
import { ADDRESS } from './constants.js'

const PING_INTERVAL_MS = 3000
/** Missed pings tolerated before the connection is declared dead. */
const PING_TIMEOUT_MISSES = 3

export class OscConnection {
	#instance
	#socket = null
	#pingTimer = null
	#lastPongAt = 0
	#everConnected = false
	#connected = false
	#reportedNoReply = false
	#config = null

	constructor(instance) {
		this.#instance = instance
	}

	get connected() {
		return this.#connected
	}

	/** Open the listening socket and begin the keepalive cycle. */
	start(config) {
		this.stop()
		this.#config = config

		if (!config.host) {
			this.#instance.updateStatus(InstanceStatus.BadConfig, 'No console IP address configured')
			return
		}

		this.#instance.updateStatus(InstanceStatus.Connecting, 'Waiting for /console/pong')

		try {
			// A shared socket lets several Companion connections listen on the same
			// port, which matters because the console pushes to one fixed port number.
			this.#socket = this.#instance.createSharedUdpSocket('udp4', (message, rinfo) => {
				this.#handleMessage(message, rinfo)
			})

			this.#socket.on('error', (err) => {
				this.#instance.log('error', `UDP socket error: ${err.message}`)
				this.#instance.updateStatus(InstanceStatus.ConnectionFailure, err.message)
			})

			this.#socket.on('listening', () => {
				this.#instance.log('debug', `Listening for console OSC on UDP ${config.localPort}`)
			})

			this.#socket.bind(config.localPort)
		} catch (err) {
			this.#instance.log('error', `Failed to bind UDP port ${config.localPort}: ${err.message}`)
			this.#instance.updateStatus(InstanceStatus.ConnectionFailure, `Cannot bind port ${config.localPort}`)
			return
		}

		this.#lastPongAt = Date.now()
		this.#ping()
		this.#pingTimer = setInterval(() => this.#ping(), PING_INTERVAL_MS)
	}

	stop() {
		if (this.#pingTimer) {
			clearInterval(this.#pingTimer)
			this.#pingTimer = null
		}
		if (this.#socket) {
			try {
				this.#socket.close()
			} catch {
				// Already closed - nothing to do.
			}
			this.#socket = null
		}
		this.#connected = false
		this.#everConnected = false
		this.#reportedNoReply = false
	}

	/**
	 * Send an OSC message to the console.
	 * @param {string} address
	 * @param {Array<{type: string, value?: any}>} args Omit/empty to query the current value.
	 */
	send(address, args = []) {
		if (!this.#socket || !this.#config?.host) return

		let buffer
		try {
			buffer = encodeMessage(address, args)
		} catch (err) {
			this.#instance.log('error', `Could not encode ${address}: ${err.message}`)
			return
		}

		try {
			this.#socket.send(buffer, this.#config.consolePort, this.#config.host)
			if (this.#config.logOutbound) {
				this.#instance.log('debug', `TX ${address} ${describeArgs(args)}`)
			}
		} catch (err) {
			this.#instance.log('error', `Failed to send ${address}: ${err.message}`)
		}
	}

	/** Ask the console for the current value of an address (a message with no arguments). */
	query(address) {
		this.send(address, [])
	}

	/** Ask the console to push every property it knows about. */
	requestResend() {
		this.send(ADDRESS.RESEND, [])
	}

	#ping() {
		this.send(ADDRESS.PING, [])

		const silentFor = Date.now() - this.#lastPongAt
		if (silentFor <= PING_INTERVAL_MS * PING_TIMEOUT_MISSES) return

		if (this.#connected) {
			this.#connected = false
			this.#instance.updateStatus(InstanceStatus.ConnectionFailure, 'Console stopped responding')
			this.#instance.onConnectionChange(false)
		} else if (!this.#reportedNoReply) {
			// Report the never-connected case once, rather than on every ping.
			this.#reportedNoReply = true
			this.#instance.updateStatus(
				InstanceStatus.ConnectionFailure,
				'No reply from console - check OSC is enabled and this controller is added on the desk',
			)
		}
	}

	#handleMessage(message, rinfo) {
		// The shared socket may carry traffic for other connections on the same port.
		if (this.#config?.host && rinfo?.address && rinfo.address !== this.#config.host) return

		const packets = decodePacket(message)
		for (const packet of packets) {
			if (this.#config?.logInbound) {
				this.#instance.log('debug', `RX ${packet.address} ${describeArgs(packet.args)}`)
			}

			if (packet.address === ADDRESS.PONG) {
				this.#onPong()
				continue
			}

			this.#instance.onOscMessage(packet)
		}
	}

	#onPong() {
		this.#lastPongAt = Date.now()
		this.#reportedNoReply = false
		if (this.#connected) return

		this.#connected = true
		const firstTime = !this.#everConnected
		this.#everConnected = true
		this.#instance.updateStatus(InstanceStatus.Ok)
		this.#instance.log('info', 'Console responded to ping')
		this.#instance.onConnectionChange(true, firstTime)
	}
}

function describeArgs(args) {
	if (!args || args.length === 0) return '(no args)'
	return args
		.map((a) => {
			if (a.type === 'T') return 'true'
			if (a.type === 'F') return 'false'
			if (a.type === 'b') return `<blob ${a.value?.length ?? 0}b>`
			return `${a.value}`
		})
		.join(' ')
}
