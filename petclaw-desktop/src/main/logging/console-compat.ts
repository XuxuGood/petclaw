const CONSOLE_COMPAT_MODULE = 'ConsoleCompat'
const MODULE_PREFIX_PATTERN = /^\[([A-Za-z][A-Za-z0-9_-]{1,79})]\s*(.*)$/

export interface ResolvedConsoleCompatLog {
  module: string
  args: unknown[]
}

export function resolveConsoleCompatLog(args: unknown[]): ResolvedConsoleCompatLog {
  const [firstArg, ...restArgs] = args
  if (typeof firstArg !== 'string') {
    return { module: CONSOLE_COMPAT_MODULE, args }
  }

  const match = MODULE_PREFIX_PATTERN.exec(firstArg)
  if (!match) {
    return { module: CONSOLE_COMPAT_MODULE, args }
  }

  const [, module, message] = match
  return {
    module,
    args: [message.length > 0 ? message : firstArg, ...restArgs]
  }
}
