import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readAppSettings, writeAppSettings } from '../../src/main/app-settings'

describe('app-settings', () => {
  let tmpDir: string
  let settingsPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petclaw-settings-test-'))
    settingsPath = path.join(tmpDir, 'petclaw-settings.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty object when file does not exist', () => {
    expect(readAppSettings(settingsPath)).toEqual({})
  })

  it('reads settings from JSON file', () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        windowBounds: { x: 100, y: 200, width: 800, height: 600 },
        petPosition: { x: 50, y: 50 }
      })
    )

    const settings = readAppSettings(settingsPath)
    expect(settings.windowBounds).toEqual({ x: 100, y: 200, width: 800, height: 600 })
    expect(settings.petPosition).toEqual({ x: 50, y: 50 })
  })

  it('returns empty object when file contains invalid JSON', () => {
    fs.writeFileSync(settingsPath, 'not-json')
    expect(readAppSettings(settingsPath)).toEqual({})
  })

  it('writes settings to JSON file and creates parent dirs', () => {
    const nestedPath = path.join(tmpDir, 'sub', 'dir', 'settings.json')
    writeAppSettings(nestedPath, {
      windowBounds: { x: 0, y: 0, width: 1024, height: 768 }
    })

    const written = readAppSettings(nestedPath)
    expect(written.windowBounds).toEqual({ x: 0, y: 0, width: 1024, height: 768 })
  })
})
