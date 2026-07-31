import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { argToValue, decodePacket, encodeMessage } from '../src/osc-codec.js'

/** Round-trip helper. */
function roundTrip(address, args) {
	const packets = decodePacket(encodeMessage(address, args))
	assert.equal(packets.length, 1)
	return packets[0]
}

describe('OSC encoding', () => {
	it('pads addresses and type tags to 4-byte boundaries', () => {
		// '/mute' is 5 bytes + NUL -> 8; ',' + NUL -> 4.
		const buf = encodeMessage('/mute', [])
		assert.equal(buf.length % 4, 0)
		assert.equal(buf.length, 12)
	})

	it('emits T/F type tags with no payload for booleans', () => {
		const buf = encodeMessage('/channel/1/mute', [{ type: 'T' }])
		const text = buf.toString('latin1')
		assert.ok(text.includes(',T'))
		// address(16) + tagstring(4) and nothing more
		assert.equal(buf.length, 20)
	})

	it('round-trips a float argument', () => {
		const packet = roundTrip('/channel/1/input/fader', [{ type: 'f', value: -12.5 }])
		assert.equal(packet.address, '/channel/1/input/fader')
		assert.equal(argToValue(packet.args), -12.5)
	})

	it('round-trips an integer argument', () => {
		const packet = roundTrip('/digico/snapshots/fire', [{ type: 'i', value: 42 }])
		assert.equal(argToValue(packet.args), 42)
	})

	it('round-trips a string argument', () => {
		const packet = roundTrip('/channel/1/input/name', [{ type: 's', value: 'Kick In' }])
		assert.equal(argToValue(packet.args), 'Kick In')
	})

	it('round-trips boolean true and false', () => {
		assert.equal(argToValue(roundTrip('/channel/1/mute', [{ type: 'T' }]).args), true)
		assert.equal(argToValue(roundTrip('/channel/1/mute', [{ type: 'F' }]).args), false)
	})

	it('treats a message with no arguments as a query', () => {
		const packet = roundTrip('/console/ping', [])
		assert.equal(packet.address, '/console/ping')
		assert.equal(argToValue(packet.args), undefined)
	})

	it('rejects an unknown argument type rather than emitting garbage', () => {
		assert.throws(() => encodeMessage('/x', [{ type: 'z', value: 1 }]), /Unsupported OSC argument type/)
	})
})

describe('OSC decoding', () => {
	it('unwraps a bundle into its messages', () => {
		const a = encodeMessage('/channel/1/mute', [{ type: 'T' }])
		const b = encodeMessage('/channel/2/mute', [{ type: 'F' }])
		const size = (buf) => {
			const s = Buffer.alloc(4)
			s.writeInt32BE(buf.length, 0)
			return s
		}
		const bundle = Buffer.concat([
			Buffer.from('#bundle\0', 'latin1'),
			Buffer.alloc(8), // timetag
			size(a),
			a,
			size(b),
			b,
		])

		const packets = decodePacket(bundle)
		assert.equal(packets.length, 2)
		assert.equal(packets[0].address, '/channel/1/mute')
		assert.equal(argToValue(packets[0].args), true)
		assert.equal(packets[1].address, '/channel/2/mute')
		assert.equal(argToValue(packets[1].args), false)
	})

	it('handles an address sent with no type-tag string at all', () => {
		// Some senders omit the tag string entirely for argument-less messages.
		const buf = Buffer.from('/console/pong\0\0\0', 'latin1')
		const packets = decodePacket(buf)
		assert.equal(packets.length, 1)
		assert.equal(packets[0].address, '/console/pong')
		assert.deepEqual(packets[0].args, [])
	})

	it('returns nothing for an empty or truncated datagram', () => {
		assert.deepEqual(decodePacket(Buffer.alloc(0)), [])
		assert.deepEqual(decodePacket(Buffer.from([1, 2])), [])
	})
})
