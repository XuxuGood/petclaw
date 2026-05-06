interface EditShortcutEvent {
  preventDefault: () => void
}

interface EditShortcutInput {
  type: string
  key: string
  control?: boolean
  meta?: boolean
}

interface EditShortcutWebContents {
  on: (
    event: 'before-input-event',
    listener: (event: EditShortcutEvent, input: EditShortcutInput) => void
  ) => void
  undo: () => void
  redo: () => void
  cut: () => void
  copy: () => void
  paste: () => void
  selectAll: () => void
}

export function registerEditShortcuts(webContents: EditShortcutWebContents): void {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (!input.control && !input.meta)) return

    const key = input.key.toLowerCase()
    if (key === 'z') {
      event.preventDefault()
      webContents.undo()
      return
    }
    if (key === 'y') {
      event.preventDefault()
      webContents.redo()
      return
    }
    if (key === 'x') {
      event.preventDefault()
      webContents.cut()
      return
    }
    if (key === 'c') {
      event.preventDefault()
      webContents.copy()
      return
    }
    if (key === 'v') {
      event.preventDefault()
      webContents.paste()
      return
    }
    if (key === 'a') {
      event.preventDefault()
      webContents.selectAll()
    }
  })
}
