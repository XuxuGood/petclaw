// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ElectronAPI {}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
