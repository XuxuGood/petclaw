export interface AIProvider {
  connect(): Promise<void>
  chat(message: string): AsyncGenerator<string, void, unknown>
  disconnect(): void
  isConnected(): boolean
}
