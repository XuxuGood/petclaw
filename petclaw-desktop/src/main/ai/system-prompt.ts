import { buildScheduledTaskPrompt } from './managed-prompts'

export function mergeCoworkSystemPrompt(options: { userPrompt?: string }): string {
  const sections = [buildScheduledTaskPrompt(), options.userPrompt?.trim() ?? ''].filter(Boolean)
  return sections.join('\n\n')
}
