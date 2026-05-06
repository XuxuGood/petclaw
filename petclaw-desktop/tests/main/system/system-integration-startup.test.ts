import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

describe('system integration startup order', () => {
  it('installs desktop system menus before BootCheck and pet readiness', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/main/index.ts'), 'utf-8')

    const actionsIndex = source.indexOf('const systemActions = createSystemActions')
    const installIndex = source.indexOf('initializeMacosIntegration({ actions: systemActions })')
    const bootCheckIndex = source.indexOf('const bootResult = await runBootCheck')
    const petReadyIndex = source.indexOf("safeOn('app:pet-ready'")

    expect(actionsIndex).toBeGreaterThan(-1)
    expect(installIndex).toBeGreaterThan(-1)
    expect(bootCheckIndex).toBeGreaterThan(-1)
    expect(petReadyIndex).toBeGreaterThan(-1)

    expect(actionsIndex).toBeLessThan(bootCheckIndex)
    expect(installIndex).toBeLessThan(bootCheckIndex)
    expect(installIndex).toBeLessThan(petReadyIndex)
  })

  it('registers runtime IPC before notifying the renderer that boot completed', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/main/index.ts'), 'utf-8')

    const registerFunctionIndex = source.indexOf('function registerRuntimeIpcHandlers')
    const initialRegisterIndex = source.indexOf('registerRuntimeIpcHandlers()')
    const bootCompleteIndex = source.indexOf("chatWindow.webContents.send('boot:complete'")
    const petReadyIndex = source.indexOf("safeOn('app:pet-ready'")

    expect(registerFunctionIndex).toBeGreaterThan(-1)
    expect(initialRegisterIndex).toBeGreaterThan(registerFunctionIndex)
    expect(bootCompleteIndex).toBeGreaterThan(-1)
    expect(petReadyIndex).toBeGreaterThan(-1)
    expect(initialRegisterIndex).toBeLessThan(bootCompleteIndex)
    expect(initialRegisterIndex).toBeLessThan(petReadyIndex)
  })

  it('activates the app when showing the BootCheck window', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/main/index.ts'), 'utf-8')

    const importIndex = source.indexOf(
      "import { activateMainWindow } from './system/window-activation'"
    )
    const bootWindowActivateIndex = source.indexOf(
      'activateMainWindow({ app, window: chatWindow })'
    )
    const rawShowIndex = source.indexOf('chatWindow.show()')
    const bootCheckIndex = source.indexOf('const bootResult = await runBootCheck')

    expect(importIndex).toBeGreaterThan(-1)
    expect(bootWindowActivateIndex).toBeGreaterThan(-1)
    expect(bootCheckIndex).toBeGreaterThan(-1)
    expect(bootWindowActivateIndex).toBeLessThan(bootCheckIndex)
    expect(rawShowIndex).toBe(-1)
  })

  it('reactivates the main window after the pet window becomes visible', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/main/index.ts'), 'utf-8')

    const petReadyIndex = source.indexOf("safeOn('app:pet-ready'")
    const petCreateIndex = source.indexOf('const petWindow = createPetWindow(db)', petReadyIndex)
    const petReadyShowIndex = source.indexOf("petWindow.once('ready-to-show'", petCreateIndex)
    const petActivateIndex = source.indexOf(
      'activateMainWindow({ app, window: chatWindow })',
      petReadyShowIndex
    )

    expect(petReadyIndex).toBeGreaterThan(-1)
    expect(petCreateIndex).toBeGreaterThan(petReadyIndex)
    expect(petReadyShowIndex).toBeGreaterThan(petCreateIndex)
    expect(petActivateIndex).toBeGreaterThan(petReadyShowIndex)
  })
})
