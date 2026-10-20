// The compact chip row: battery and minutes, whole dollars, context tokens,
// limits with decimal resets, and the project|branch chip that cuts itself
// with `…` to fit the room the others leave.

import { test, expect } from 'claude-code/testing'
import { makeKit } from '../hooks/kit'
import { DARK } from '../hooks/palette'
import { readingsOf } from '../hooks/reading'
import type { BandSnapshot } from '../hooks/snapshot'
import { chipsView } from '../hooks/views/chips'
import { byKey, fakeEl, firstRow, pillKeys, shown, type Node } from './helpers'
import { NO_ACT, snapOf } from './matrix'

const LONG_BRANCH = 'feature/a-very-long-branch-name-that-will-not-fit'

const rowOf = (columns: number, over: Partial<BandSnapshot> = {}): Node => {
  const snap = snapOf({
    columns,
    workspace: {
      path: '/Users/me/workspace/claude-mod',
      repoName: undefined,
      git: { branch: LONG_BRANCH, commit: 'a1b2c3d', worktree: undefined, changed: 0, ahead: 0, behind: 0 },
    },
    ...over,
  })
  return firstRow(chipsView.draw(makeKit(fakeEl, snap), readingsOf(snap), NO_ACT)) as Node
}

test('the row runs cache, cost, context, 5h, 7d, then the project', () => {
  expect(pillKeys(rowOf(200))).toEqual(['cache', 'cost', 'ctx', '5h', '7d', 'ws'])
})

test('with room, the project chip shows the folder and the whole branch', () => {
  expect(shown(byKey(rowOf(200), 'ws', 'Box'))).toContain(`claude-mod|${LONG_BRANCH}`)
})

test('short of room, the project chip is cut with … rather than dropped', () => {
  const ws = shown(byKey(rowOf(100), 'ws', 'Box'))
  expect(ws).toMatch(/…$/)
  expect(ws).toContain('claude-mod')
  expect(ws).not.toContain(LONG_BRANCH)
})

test('the cut chip keeps the whole row inside its columns', () => {
  for (const columns of [80, 90, 100, 120]) {
    const row = rowOf(columns)
    // The text and the column of air between pills.
    expect(shown(row).length + pillKeys(row).length).toBeLessThanOrEqual(columns)
  }
})

test('every fact on a pill is in its main ink; only the | is grey', () => {
  const row = rowOf(200)
  for (const [key, main] of [['5h', DARK.fiveFg], ['7d', DARK.weekFg], ['ws', DARK.value]] as const) {
    const chip = byKey(row, key, 'Box')
    expect([byKey(chip, 'a', 'Text')?.props?.color, byKey(chip, 'b', 'Text')?.props?.color]).toEqual([main, main])
    expect(byKey(chip, 'rule', 'Text')?.props?.color).toBe(DARK.label)
  }
})

test('the limits read usage then a decimal reset, the cost whole dollars', () => {
  const row = rowOf(200)
  expect(shown(byKey(row, '5h', 'Box'))).toMatch(/\d+%\|\d+\.\d\dh/)
  expect(shown(byKey(row, '7d', 'Box'))).toMatch(/\d+%\|\d+\.\dd/)
  expect(shown(byKey(row, 'cost', 'Box'))).toMatch(/\$\d+$/)
})
