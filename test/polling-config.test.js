import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_CONFIG, getConfigFields, normaliseConfig } from '../src/config.js'

describe('pollIntervalSec defaults and normalisation', () => {
	it('defaults to a non-zero interval, so refresh is on out of the box', () => {
		assert.ok(DEFAULT_CONFIG.pollIntervalSec > 0)
		assert.equal(normaliseConfig({}).pollIntervalSec, DEFAULT_CONFIG.pollIntervalSec)
	})

	it('preserves an explicit 0, which means "disabled" - unlike the port fields, 0 is not "unset"', () => {
		assert.equal(normaliseConfig({ pollIntervalSec: 0 }).pollIntervalSec, 0)
	})

	it('coerces a string from the config store to a number', () => {
		assert.equal(normaliseConfig({ pollIntervalSec: '45' }).pollIntervalSec, 45)
		assert.equal(normaliseConfig({ pollIntervalSec: '0' }).pollIntervalSec, 0)
	})

	it('falls back to the default for garbage input rather than producing NaN', () => {
		for (const bad of [-10, 'not a number', null, undefined, NaN]) {
			assert.equal(normaliseConfig({ pollIntervalSec: bad }).pollIntervalSec, DEFAULT_CONFIG.pollIntervalSec)
		}
	})

	it('rounds a fractional value', () => {
		assert.equal(normaliseConfig({ pollIntervalSec: 12.6 }).pollIntervalSec, 13)
	})
})

describe('pollIntervalSec config field', () => {
	const field = getConfigFields().find((f) => f.id === 'pollIntervalSec')

	it('exists, allows 0, and matches the default', () => {
		assert.ok(field, 'pollIntervalSec field is missing from the config UI')
		assert.equal(field.type, 'number')
		assert.equal(field.min, 0)
		assert.equal(field.default, DEFAULT_CONFIG.pollIntervalSec)
	})

	it('clamps rather than rejects, so a stray high value does not lock the user out', () => {
		assert.equal(field.clampValues, true)
	})
})
