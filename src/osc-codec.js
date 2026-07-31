/**
 * Minimal, dependency-free OSC 1.0 encoder/decoder.
 *
 * Companion's built-in `oscSend()` can only emit the `i`, `f`, `s` and `b` argument
 * types. The S-Series expresses every one of its `false/true` parameters using the
 * OSC `T` / `F` type tags by default, which that API cannot produce - so this module
 * carries its own codec and drives a UDP socket directly.
 */

const BUNDLE_TAG = '#bundle'

/** Encode an OSC-string: NUL-terminated, then NUL-padded to a multiple of 4 bytes. */
function encodeString(str) {
	const byteLength = Buffer.byteLength(str, 'utf8')
	const buf = Buffer.alloc(Math.ceil((byteLength + 1) / 4) * 4)
	buf.write(str, 0, 'utf8')
	return buf
}

function encodeInt32(value) {
	const buf = Buffer.alloc(4)
	// Clamp into int32 range so a wild value cannot throw mid-send.
	buf.writeInt32BE(Math.max(-2147483648, Math.min(2147483647, Math.round(value) || 0)), 0)
	return buf
}

function encodeFloat32(value) {
	const buf = Buffer.alloc(4)
	buf.writeFloatBE(Number.isFinite(value) ? value : 0, 0)
	return buf
}

function encodeBlob(value) {
	const data = Buffer.from(value)
	const padded = Buffer.alloc(4 + Math.ceil(data.length / 4) * 4)
	padded.writeInt32BE(data.length, 0)
	data.copy(padded, 4)
	return padded
}

/**
 * Encode a single OSC message.
 *
 * @param {string} address OSC address pattern, e.g. `/channel/1/mute`
 * @param {Array<{type: string, value?: any}>} args Typed arguments. Types carrying no
 *   payload (`T`, `F`, `N`, `I`) contribute only a tag character.
 * @returns {Buffer}
 */
export function encodeMessage(address, args = []) {
	let tags = ','
	const payload = []

	for (const arg of args) {
		switch (arg.type) {
			case 'i':
				tags += 'i'
				payload.push(encodeInt32(arg.value))
				break
			case 'f':
				tags += 'f'
				payload.push(encodeFloat32(arg.value))
				break
			case 's':
				tags += 's'
				payload.push(encodeString(String(arg.value ?? '')))
				break
			case 'b':
				tags += 'b'
				payload.push(encodeBlob(arg.value))
				break
			case 'T':
			case 'F':
			case 'N':
			case 'I':
				tags += arg.type
				break
			default:
				throw new Error(`Unsupported OSC argument type: ${arg.type}`)
		}
	}

	return Buffer.concat([encodeString(address), encodeString(tags), ...payload])
}

/** Read a NUL-terminated, 4-byte-aligned string. Returns `[value, nextOffset]`. */
function readString(buffer, offset) {
	let end = offset
	while (end < buffer.length && buffer[end] !== 0) end++
	if (end >= buffer.length) throw new Error('Unterminated OSC string')
	const value = buffer.toString('utf8', offset, end)
	return [value, offset + Math.ceil((end - offset + 1) / 4) * 4]
}

function decodeMessageAt(buffer, offset, end) {
	const [address, afterAddress] = readString(buffer, offset)
	const args = []

	// The type-tag string is technically optional in OSC 1.0. The S-Series omits it
	// when a command carries no payload, and a value query is sent the same way.
	if (afterAddress >= end) return { address, args }

	const [tags, afterTags] = readString(buffer, afterAddress)
	if (!tags.startsWith(',')) return { address, args }

	let pos = afterTags
	for (const tag of tags.slice(1)) {
		switch (tag) {
			case 'i':
				args.push({ type: 'i', value: buffer.readInt32BE(pos) })
				pos += 4
				break
			case 'f':
				args.push({ type: 'f', value: buffer.readFloatBE(pos) })
				pos += 4
				break
			case 'd':
				args.push({ type: 'f', value: buffer.readDoubleBE(pos) })
				pos += 8
				break
			case 'h': {
				args.push({ type: 'i', value: Number(buffer.readBigInt64BE(pos)) })
				pos += 8
				break
			}
			case 's':
			case 'S': {
				const [value, next] = readString(buffer, pos)
				args.push({ type: 's', value })
				pos = next
				break
			}
			case 'b': {
				const size = buffer.readInt32BE(pos)
				args.push({ type: 'b', value: buffer.subarray(pos + 4, pos + 4 + size) })
				pos += 4 + Math.ceil(size / 4) * 4
				break
			}
			case 'T':
				args.push({ type: 'T', value: true })
				break
			case 'F':
				args.push({ type: 'F', value: false })
				break
			case 'N':
				args.push({ type: 'N', value: null })
				break
			case 'I':
				args.push({ type: 'I', value: Infinity })
				break
			case 'c':
				args.push({ type: 's', value: String.fromCharCode(buffer.readInt32BE(pos)) })
				pos += 4
				break
			case 'r':
			case 'm':
				args.push({ type: 'i', value: buffer.readInt32BE(pos) })
				pos += 4
				break
			default:
				// An unknown tag makes every following offset meaningless, so stop here
				// and return what was parsed rather than emitting garbage.
				return { address, args }
		}
		if (pos > end) throw new Error('OSC message truncated')
	}

	return { address, args }
}

/**
 * Decode a UDP datagram into a flat list of OSC messages. Bundles are unwrapped
 * recursively; timetags are ignored (the console sends immediate bundles only).
 *
 * @param {Buffer} buffer
 * @returns {Array<{address: string, args: Array<{type: string, value: any}>}>}
 */
export function decodePacket(buffer) {
	if (!buffer || buffer.length < 4) return []

	const messages = []
	const walk = (offset, end) => {
		if (end - offset < 4) return

		if (buffer[offset] === 0x23 /* '#' */) {
			const [tag, afterTag] = readString(buffer, offset)
			if (tag !== BUNDLE_TAG) return
			let pos = afterTag + 8 // skip the 64-bit timetag
			while (pos + 4 <= end) {
				const size = buffer.readInt32BE(pos)
				pos += 4
				if (size < 0 || pos + size > end) return
				walk(pos, pos + size)
				pos += size
			}
			return
		}

		messages.push(decodeMessageAt(buffer, offset, end))
	}

	try {
		walk(0, buffer.length)
	} catch {
		// A malformed datagram yields whatever was parsed before the failure.
	}

	return messages
}

/** Coerce a decoded OSC argument list to a single JS value, or `undefined` if empty. */
export function argToValue(args) {
	if (!args || args.length === 0) return undefined
	const first = args[0]
	if (first.type === 'T') return true
	if (first.type === 'F') return false
	return first.value
}
