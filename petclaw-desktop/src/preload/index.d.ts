interface ElectronAPI {
  moveWindow: (dx: number, dy: number) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
