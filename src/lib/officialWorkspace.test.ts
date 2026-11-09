import { describe, expect, it } from 'vitest'
import {
  assignedMatchStatusLabel, officialRoleLabel, splitAssignedMatches, staffPermissionLabel, validateAvailability,
} from './officialWorkspace'

describe('officialWorkspace pure helpers', () => {
  it('labels roles and permissions', () => {
    expect(officialRoleLabel('reviewer')).toBe('Result reviewer')
    expect(staffPermissionLabel('finance')).toBe('Finance staff')
    expect(assignedMatchStatusLabel('confirmed')).toBe('Official')
  })
  it('splitAssignedMatches separates concluded from upcoming', () => {
    const rows = [
      { assignmentRole: 'official', assignedAt: null, match: { id: 'm1', status: 'confirmed', scheduledAt: '2026-01-01T10:00:00Z', venue: null, tournamentName: '', tournamentSlug: '', tournamentSport: '' } },
      { assignmentRole: 'official', assignedAt: null, match: { id: 'm2', status: 'scheduled', scheduledAt: '2099-01-01T10:00:00Z', venue: null, tournamentName: '', tournamentSlug: '', tournamentSport: '' } },
    ]
    const result = splitAssignedMatches(rows, '2026-06-01T00:00:00Z')
    expect(result.past.map(row => row.match.id)).toEqual(['m1'])
    expect(result.upcoming.map(row => row.match.id)).toEqual(['m2'])
  })
  it('validateAvailability rejects inverted ranges', () => {
    expect(validateAvailability({ availableFrom: '2026-02-02', availableTo: '2026-01-01' })).not.toBeNull()
    expect(validateAvailability({ availableFrom: '2026-01-01', availableTo: '2026-02-02' })).toBeNull()
  })
})