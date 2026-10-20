// Chips: a row of pills, and its four cards beneath it when open. Its pill
// builders, their hover strings, LIMITS and its row are exported, so a layout
// composes chips' pills, tints and icons rather than drawing its own. They
// draw from the readings' words; only the context's pill and hover read
// raw facts (`read.chips.raw`).

import type { RenderChildren, RenderElement } from 'claude-code'
import { fmtTokens, fmtWholeCost, HOUR_MS, DAY_MS, severityMark } from '../format'
import type { Icon } from '../icons'
import type { Kit } from '../kit'
import { GIVES_WAY, ROW_SLACK, cellsOf, keeps, spansOf, squeezeToFit } from '../layout'
import type { Piece } from '../layout'
import type { Palette } from '../palette'
import type { LimitKey, Readings } from '../reading'
import type { BandActions } from '../snapshot'
import { cardsView } from './cards'
import { toggleButton } from './frame'
import { batteryIcon, cacheHover, pill, textBattery } from './parts'
import { gitSummary, splitPath } from '../workspace'
import type { PillSpec } from './parts'
import type { View } from './view'

// ---- limits ---------------------------------------------------------------

type ChipKey = Exclude<LimitKey, 'other'>
type Tint = Readonly<{ bg: string; fg: string; accent: string }>
type LimitSpec = Readonly<{
  icon: Icon
  title: string
  calm: Piece
  reset: Piece
  amberReset: Piece
  tint: (p: Readonly<Palette>) => Tint
}>

/** The two limit chips: one shape, their own tint and steps. A layout's
 *  own limit pills take their icon and tint from here. */
export const LIMITS: Readonly<Record<ChipKey, LimitSpec>> = {
  '5h': {
    icon: 'five',
    title: '5-hour limit',
    calm: 'calmFive',
    reset: 'fiveReset',
    amberReset: 'amberFiveReset',
    tint: p => ({ bg: p.fiveBg, fg: p.fiveFg, accent: p.fiveAccent }),
  },
  '7d': {
    icon: 'week',
    title: 'Weekly limit',
    calm: 'calmWeek',
    reset: 'weekReset',
    amberReset: 'amberWeekReset',
    tint: p => ({ bg: p.weekBg, fg: p.weekFg, accent: p.weekAccent }),
  },
}

// ---- the pills --------------------------------------------------------------

/** The cache pill: a draining battery and its minutes, or its mood. A
 *  layout that bolds each reading's figure asks for the countdown `bold`;
 *  chips' own draws it plain. */
export const cachePill = (kit: Kit, read: Readings, short: boolean, bold = false): PillSpec => {
  const { Text, Svg, palette, onTone } = kit
  const { mood, tone, charge } = read.cache
  const { copy } = read.chips.reading
  const text = copy.pill(short)
  const figure = bold && copy.figure !== undefined && text.endsWith(copy.figure) ? copy.figure : ''
  const fg = onTone(tone, palette.value)
  /** The text, its figure bold when asked: `cache ` then `52m`. */
  const words = (key: string, said: string): RenderElement[] =>
    figure === ''
      ? [<Text key={key} color={fg}>{said}</Text>]
      : [
          <Text key={key} color={fg}>
            {said.slice(0, said.length - figure.length)}
          </Text>,
          <Text key={`${key}-fig`} color={fg} bold>
            {figure}
          </Text>,
        ]
  if (Svg) {
    // A normal rounded pill led by a draining battery icon; the text-surface
    // battery would paint a square-cornered block here.
    return { key: 'cache', tone, body: [batteryIcon(kit, charge, tone, copy.alt), ...words('c', ` ${text}`)], hover: cacheHover(read) }
  }
  if (palette.filled) {
    return {
      key: 'cache',
      tone,
      body: textBattery(kit, charge, tone, [[`◷ ${text.slice(0, text.length - figure.length)}`, false], [figure, true]]),
      hover: cacheHover(read),
      paintsOwnBg: true,
    }
  }
  const dot = mood === 'warm' || mood === 'expiring' ? palette.warm : palette.cold
  return {
    key: 'cache',
    tone,
    body: [tone === 'amber' ? null : <Text key="dot" color={dot}>{'● '}</Text>, ...words('c', tone === 'amber' ? `◷ ${text}` : text)],
    hover: cacheHover(read),
  }
}

// ---- inks -------------------------------------------------------------------

/** The `|` between two facts on a pill. */
const RULE = '|'

/** Two facts as `first|second`: both in the pill's main ink, which holds about
 *  10:1 on its ground, and only the rule in label ink, so nothing a reader
 *  needs sits in the dimmer grey. `second` undefined draws `first` alone. */
const pair = (kit: Kit, ink: Readonly<{ main: string; rule: string }>, first: string, second: string | undefined, boldFirst = false): RenderChildren[] => {
  const { Text } = kit
  return [
    <Text key="a" color={ink.main} {...(boldFirst ? { bold: true } : {})}>
      {first}
    </Text>,
    ...(second === undefined
      ? []
      : [
          <Text key="rule" color={ink.rule}>
            {RULE}
          </Text>,
          <Text key="b" color={ink.main}>
            {second}
          </Text>,
        ]),
  ]
}

/** The session's cost; its card names the last message's. */
const costPill = (kit: Kit, read: Readings): PillSpec => {
  const { Text, palette, icon } = kit
  const { totalText, totalUsd, lastText } = read.spend
  return {
    key: 'cost',
    tone: 'calm',
    // Whole dollars on the row; the cents are in the hover and the cards.
    body: [...icon('cost', palette.coin), <Text key="v" color={palette.value} bold>{fmtWholeCost(totalUsd)}</Text>],
    hover: lastText === undefined ? `${totalText} so far this session` : `${lastText} spent during your last message, subagents included`,
  }
}

/** The context pill's hover card: how much of the window is used, and where it compacts. */
const contextHover = (read: Readings): string => {
  const ctx = read.chips.raw.context
  const { pct, toCompact } = read.context
  return ctx.compactAt === undefined || toCompact === undefined
    ? `${fmtTokens(read.context.used)} of ${fmtTokens(ctx.window)} (${pct}); older turns get summarized near full`
    : `${fmtTokens(read.context.used)} of ${fmtTokens(ctx.compactAt)} (${pct}); auto-compacts in ~${fmtTokens(toCompact)}`
}

/** The context in use as tokens, `120k`, with a mark once near full when
 *  compaction is off. */
const contextPill = (kit: Kit, read: Readings): PillSpec => {
  const { Text, palette, onTone, icon } = kit
  const ctx = read.chips.raw.context
  const { frac, used, tone } = read.context
  const mark = ctx.compactAt === undefined ? severityMark(frac) : ''
  return {
    key: 'ctx',
    tone,
    body: [
      ...icon('context', onTone(tone, palette.label)),
      <Text key="v" color={onTone(tone, palette.value)}>
        {`${fmtTokens(used)}${mark}`}
      </Text>,
    ],
    hover: contextHover(read),
  }
}

/** A limit chip's hover card: once passed, that it has reset; else its
 *  reset first, the fact the chip had, so a short row's cut only takes the
 *  description. Undefined while the engine reports no such window. */
const limitHover = (read: Readings, key: ChipKey): string | undefined => {
  const w = key === '5h' ? read.fiveHour : read.sevenDay
  if (w === undefined) return undefined
  const { title } = LIMITS[key]
  const r = w.reset
  if (r?.kind === 'passed') return `${title} has reset; it updates after your next message`
  const pace = w.pace === '' ? '' : `; ${w.pace}`
  return r === undefined ? `Your ${title.toLowerCase()}, across all your Claude use` : `Resets in ${r.text}${pace}; ${title.toLowerCase()}, all your Claude use`
}

/** The time to a limit's reset as a decimal: the 5h window in hours,
 *  `4.43h`, the weekly in days, `0.3d`. */
const resetDecimal = (key: ChipKey, ms: number): string => (key === '5h' ? `${(ms / HOUR_MS).toFixed(2)}h` : `${(ms / DAY_MS).toFixed(1)}d`)

/** A limit chip: its icon, usage and reset, `6%|4.43h`. A window whose
 *  reset has passed shows as reset: its last reading is from before it.
 *  Undefined while the engine reports no such window. */
export const limitPill = (kit: Kit, read: Readings, key: ChipKey, squeeze: number): PillSpec | undefined => {
  const { Text, Svg, palette, onTone, icon } = kit
  const w = key === '5h' ? read.fiveHour : read.sevenDay
  if (w === undefined) return undefined
  const spec = LIMITS[key]
  // The desktop's icon names the window; a text surface has no glyph for it, so says it.
  const lead = (color: string) => (Svg ? icon(spec.icon, color) : [<Text key="i" color={color}>{`${key} `}</Text>])
  const tint = spec.tint(palette)
  const { reset: r, frac, tone, resetInMs } = w
  if (r?.kind === 'passed') {
    return {
      key,
      tone: 'calm',
      bg: tint.bg,
      body: [...lead(tint.accent), <Text key="l" color={tint.fg}>{'reset'}</Text>],
      hover: limitHover(read, key),
    }
  }
  const ink = { main: onTone(tone, tint.fg), rule: onTone(tone, palette.label) }
  const showReset = resetInMs !== undefined && keeps(squeeze, tone === 'amber' ? spec.amberReset : spec.reset)
  return {
    key,
    tone,
    bg: tint.bg,
    body: [
      ...lead(onTone(tone, tint.accent)),
      ...pair(kit, ink, `${w.value}${severityMark(frac)}`, showReset ? resetDecimal(key, resetInMs) : undefined, true),
    ],
    hover: limitHover(read, key),
  }
}

/** The fewest characters the project chip shows; with less room it gives way. */
const WORKSPACE_MIN_CHARS = 4

/** Where the session is: its project folder and git branch,
 *  `claude-mod|main`, the folder alone outside a repository, cut with `…`
 *  to fit the `room` cells the other chips leave. Undefined until the
 *  workspace has been read, or with too little room. */
const workspacePill = (kit: Kit, read: Readings, room: number): PillSpec | undefined => {
  const { Text, Svg, palette, icon, measure } = kit
  const ws = read.workspace
  if (ws === undefined) return undefined
  const git = ws.git
  const name = splitPath(ws.path).name
  const head = git === undefined ? undefined : (git.branch ?? git.commit ?? 'detached')
  const nameLength = [...name].length
  const full = [...(head === undefined ? name : `${name}${RULE}${head}`)]
  const ink = { main: palette.value, rule: palette.label }
  /** The pill for `text`, the whole or a cut of `full`: the folder, then the
   *  rule and the branch where the cut reaches them. */
  const spec = (text: readonly string[]): PillSpec => {
    const folder = text.slice(0, nameLength).join('')
    const rest = text.slice(nameLength)
    const body =
      rest.length === 0
        ? pair(kit, ink, folder, undefined)
        : rest[0] === RULE
          ? pair(kit, ink, folder, rest.slice(1).join(''))
          : pair(kit, ink, folder + rest.join(''), undefined)
    return {
      key: 'ws',
      tone: 'calm',
      body: [...(Svg ? icon('branch', palette.label) : [<Text key="i" color={palette.label}>{'⎇ '}</Text>]), ...body],
      hover: git === undefined ? ws.path : `${ws.path}: ${gitSummary(git)}`,
    }
  }
  // A column short, as the desktop's measure is an estimate.
  const chars = Math.floor((room - 1 - cellsOf(pill(kit, spec([])), measure)) / measure.text)
  if (chars >= full.length) return spec(full)
  return chars < WORKSPACE_MIN_CHARS ? undefined : spec([...full.slice(0, chars - 1), '…'])
}

/** Chips' pills at a squeeze, in its order, but for the project, which
 *  takes the room left: the calm ones give way by `GIVES_WAY`, and an amber one holds out. */
export const chipsPills = (kit: Kit, read: Readings, squeeze: number): PillSpec[] => {
  const calm = (tone: 'calm' | 'amber', piece: Piece) => tone === 'amber' || keeps(squeeze, piece)
  const five = read.fiveHour && calm(read.fiveHour.tone, LIMITS['5h'].calm) ? limitPill(kit, read, '5h', squeeze) : undefined
  const seven = read.sevenDay && calm(read.sevenDay.tone, LIMITS['7d'].calm) ? limitPill(kit, read, '7d', squeeze) : undefined
  return [
    cachePill(kit, read, false),
    costPill(kit, read),
    ...(read.context.known && calm(read.context.tone, 'calmContext') ? [contextPill(kit, read)] : []),
    ...(five === undefined ? [] : [five]),
    ...(seven === undefined ? [] : [seven]),
  ]
}

/** Pills in a row, each revealing its card, then air and the toggle. A card
 *  ends short of ▵ and the gap before it, and covers whole pills. */
export const pillRow = (kit: Kit, read: Readings, act: BandActions, specs: readonly PillSpec[]): RenderElement => {
  const { Box, measure, asDrawn, hoverCard } = kit
  const pills = specs.map(spec => pill(kit, spec))
  const toggle = toggleButton(kit, read, act)
  const room = kit.columns - cellsOf(toggle, measure) - 1
  const pieces = spansOf(pills.map(asDrawn), 1, measure)
  return (
    <Box key="row" flexDirection="row" flexWrap="nowrap" overflow="hidden" columnGap={1}>
      {pills}
      <Box flexGrow={1} />
      {specs.map(({ key, hover }, i) => (hover === undefined ? null : hoverCard(key, hover, { left: pieces[i]?.[0] ?? 0, room, pieces })))}
      {toggle}
    </Box>
  )
}

/** Chips' one row, squeezed until it fits; the project chip last, in the
 *  room the others leave. */
const chipsRow = (kit: Kit, read: Readings, act: BandActions): RenderElement => {
  const { measure } = kit
  const room = kit.columns - ROW_SLACK - cellsOf(toggleButton(kit, read, act), measure) - 1
  return squeezeToFit(
    squeeze => {
      const specs = chipsPills(kit, read, squeeze)
      // Each pill and the column of air after it.
      const used = specs.reduce((sum, spec) => sum + cellsOf(pill(kit, spec), measure) + 1, 0)
      const where = workspacePill(kit, read, room - used)
      return pillRow(kit, read, act, where === undefined ? specs : [...specs, where])
    },
    GIVES_WAY.length,
    kit.columns - ROW_SLACK,
    measure,
  )
}

export const chipsView: View = {
  rows: { desktop: 1, terminal: 1 },
  draw: (kit, read, act) => cardsView(kit, read, act, [chipsRow(kit, read, act)], { collapsedRows: 1 }),
}
