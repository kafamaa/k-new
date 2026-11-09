import type { Workspace } from './workspace'

export function visibleWorkspaces(workspaces: Workspace[], userId: string): Workspace[] {
  if (!userId) return []
  return workspaces.filter(workspace => Boolean(workspace.id && workspace.role))
}
