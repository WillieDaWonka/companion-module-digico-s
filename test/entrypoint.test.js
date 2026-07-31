import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { InstanceBase } from '@companion-module/base'
import { validateManifest } from '@companion-module/base/manifest'
import DigicoSSeriesInstance, { UpgradeScripts } from '../src/main.js'

const manifestPath = fileURLToPath(new URL('../companion/manifest.json', import.meta.url))

describe('module entrypoint', () => {
	it('default-exports the instance class, as module API 2.0 requires', () => {
		assert.equal(typeof DigicoSSeriesInstance, 'function')
		assert.ok(Object.prototype.isPrototypeOf.call(InstanceBase, DigicoSSeriesInstance))
	})

	it('exports upgrade scripts as an array of functions', () => {
		assert.ok(Array.isArray(UpgradeScripts))
		for (const script of UpgradeScripts) {
			assert.equal(typeof script, 'function')
		}
	})

	it('implements every abstract lifecycle method', () => {
		for (const method of ['init', 'destroy', 'configUpdated', 'getConfigFields']) {
			assert.equal(typeof DigicoSSeriesInstance.prototype[method], 'function', `missing ${method}`)
		}
	})

	it('refuses to be constructed outside Companion', () => {
		// The v2 InstanceBase constructor rejects a context it did not create, which is
		// what keeps modules from self-registering the way runEntrypoint used to.
		assert.throws(() => new DigicoSSeriesInstance({}), /constructed incorrectly/)
	})
})

describe('manifest', () => {
	it('passes the official schema validation', async () => {
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
		assert.doesNotThrow(() => validateManifest(manifest, false))
	})

	it('declares the node22 runtime and nodejs-ipc api', async () => {
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
		assert.equal(manifest.type, 'connection')
		assert.equal(manifest.runtime.type, 'node22')
		assert.equal(manifest.runtime.api, 'nodejs-ipc')
		assert.equal(manifest.runtime.entrypoint, '../src/main.js')
	})

	it('points its entrypoint at a file that exists and loads', async () => {
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
		const resolved = new URL(`../companion/${manifest.runtime.entrypoint}`, import.meta.url)
		const loaded = await import(resolved.href)
		assert.equal(typeof loaded.default, 'function')
	})
})
