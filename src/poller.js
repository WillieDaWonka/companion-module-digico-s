/**
 * Periodic "keep me synced" resend.
 *
 * The console only pushes a value when it changes, so anything that happened before
 * Companion connected - or was missed because UDP dropped a packet, or was changed by
 * another controller - never arrives on its own. `/console/resend` (see connection.js)
 * asks the desk to push its entire parameter set; this schedules that on an interval so
 * variables, feedbacks and channel names self-heal without the user doing anything.
 *
 * Factored out of main.js so the scheduling logic can be unit tested directly - building
 * a real InstanceBase needs an IPC-backed host context that only Companion itself can
 * provide, which rules out driving main.js's timers from a test.
 */

/**
 * Start a periodic timer that calls `onTick` every `intervalSeconds`, but only while
 * `isConnected()` is true - polling a console that is not there just adds log noise for
 * something the ping/pong keepalive is already reporting as down.
 *
 * @param {object} options
 * @param {number} options.intervalSeconds 0 (or any non-positive value) disables polling.
 * @param {() => boolean} options.isConnected
 * @param {() => void} options.onTick
 * @param {typeof setInterval} [options.setIntervalFn] Injectable for testing.
 * @returns {ReturnType<typeof setInterval>|null} Pass to {@link stopPolling} to cancel.
 */
export function startPolling({ intervalSeconds, isConnected, onTick, setIntervalFn = setInterval }) {
	if (!(intervalSeconds > 0)) return null

	return setIntervalFn(() => {
		if (isConnected()) onTick()
	}, intervalSeconds * 1000)
}

/** Stop a timer returned by {@link startPolling}. Tolerates null/undefined. */
export function stopPolling(timer, clearIntervalFn = clearInterval) {
	if (timer) clearIntervalFn(timer)
}
