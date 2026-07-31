/**
 * The scheduling logic behind automatic re-sync (config "Automatic refresh interval").
 * Factored out of main.js precisely so it can be driven directly here, without needing
 * a live Companion host context to construct the real instance.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { startPolling, stopPolling } from '../src/poller.js'

/** A fake setInterval that records the call and lets the test fire it manually. */
function fakeTimers() {
	const calls = []
	const setIntervalFn = (fn, ms) => {
		const handle = { fn, ms, cleared: false }
		calls.push(handle)
		return handle
	}
	const clearIntervalFn = (handle) => {
		if (handle) handle.cleared = true
	}
	return { calls, setIntervalFn, clearIntervalFn }
}

describe('startPolling', () => {
	it('does not schedule anything when the interval is 0', () => {
		const { calls, setIntervalFn } = fakeTimers()
		const timer = startPolling({ intervalSeconds: 0, isConnected: () => true, onTick: () => {}, setIntervalFn })
		assert.equal(timer, null)
		assert.equal(calls.length, 0)
	})

	it('does not schedule anything for a negative or missing interval', () => {
		const { calls, setIntervalFn } = fakeTimers()
		for (const bad of [-5, undefined, null, NaN]) {
			assert.equal(
				startPolling({ intervalSeconds: bad, isConnected: () => true, onTick: () => {}, setIntervalFn }),
				null,
			)
		}
		assert.equal(calls.length, 0)
	})

	it('schedules at the interval converted to milliseconds', () => {
		const { calls, setIntervalFn } = fakeTimers()
		startPolling({ intervalSeconds: 45, isConnected: () => true, onTick: () => {}, setIntervalFn })
		assert.equal(calls.length, 1)
		assert.equal(calls[0].ms, 45000)
	})

	it('calls onTick when the tick fires while connected', () => {
		const { setIntervalFn } = fakeTimers()
		let ticks = 0
		const timer = startPolling({
			intervalSeconds: 10,
			isConnected: () => true,
			onTick: () => ticks++,
			setIntervalFn,
		})
		timer.fn()
		timer.fn()
		assert.equal(ticks, 2)
	})

	it('skips onTick when disconnected, so it does not spam a dead connection', () => {
		const { setIntervalFn } = fakeTimers()
		let connected = false
		let ticks = 0
		const timer = startPolling({
			intervalSeconds: 10,
			isConnected: () => connected,
			onTick: () => ticks++,
			setIntervalFn,
		})
		timer.fn()
		assert.equal(ticks, 0)
		connected = true
		timer.fn()
		assert.equal(ticks, 1)
	})
})

describe('stopPolling', () => {
	it('clears a running timer', () => {
		const { calls, setIntervalFn, clearIntervalFn } = fakeTimers()
		const timer = startPolling({ intervalSeconds: 30, isConnected: () => true, onTick: () => {}, setIntervalFn })
		stopPolling(timer, clearIntervalFn)
		assert.equal(calls[0].cleared, true)
	})

	it('tolerates null, as when polling was never started', () => {
		const { clearIntervalFn } = fakeTimers()
		assert.doesNotThrow(() => stopPolling(null, clearIntervalFn))
		assert.doesNotThrow(() => stopPolling(undefined, clearIntervalFn))
	})
})
