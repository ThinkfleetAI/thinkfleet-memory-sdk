import type { ProceduralMemoryMetadata } from '../types/memory.js'

/**
 * Render a procedure into the injectable `content` string. Kept identical to
 * the engine-side renderer so author-time content matches what the server
 * would produce. Pure and deterministic.
 */
export function renderProcedureContent(meta: ProceduralMemoryMetadata): string {
  const lines: string[] = [`Goal: ${meta.goal.trim()}`]

  if (meta.whenToUse && meta.whenToUse.trim()) {
    lines.push(`When: ${meta.whenToUse.trim()}`)
  }

  lines.push('Steps:')
  meta.steps.forEach((step, i) => {
    const pitfall =
      step.pitfall && step.pitfall.trim()
        ? ` (watch out: ${step.pitfall.trim()})`
        : ''
    lines.push(`${i + 1}. ${step.text.trim()}${pitfall}`)
  })

  const failures = (meta.failureModes ?? []).filter((f) => f.trim())
  if (failures.length > 0) {
    lines.push('Avoid:')
    failures.forEach((f) => lines.push(`- ${f.trim()}`))
  }

  return lines.join('\n')
}

/** The out-of-the-box precedence ladder: human-verified > local > licensed-brain > base. */
export const DEFAULT_PRECEDENCE_POLICY = {
  defaultOrder: [
    'human_verified',
    'local',
    'licensed_brain',
    'base',
  ] as const,
  scopeNearestWins: true,
  overrides: [] as const,
}
