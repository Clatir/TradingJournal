/**
 * Day plan templates (1.4.0): a plan's pairs (draw on liquidity, scenarios, labels of key levels), intermarket
 * instruments and notes, kept in the settings and used for a new plan or inserted into an existing one.
 */
import { createDayPlan } from './defaults'
import { newId } from './ids'
import type { DayPair, DayPlan, DayTemplate, Settings } from './schema'

export function templateFromPlan(plan: DayPlan, name: string): DayTemplate {
  return {
    id: newId(),
    name: name.trim() || 'Szablon',
    pairs: plan.pairs.map((p) => ({
      pair: p.pair,
      drawOnLiquidity: p.drawOnLiquidity,
      levelLabels: p.keyLevels.map((l) => l.label).filter(Boolean),
      scenarioPrimary: p.scenarioPrimary,
      scenarioAlternative: p.scenarioAlternative
    })),
    intermarket: plan.intermarket.map((i) => i.instrument),
    notes: plan.notes,
    isDefault: false
  }
}

function pairFromTemplate(t: DayTemplate['pairs'][number], existing?: DayPair): DayPair {
  const base: DayPair = existing ?? {
    pair: t.pair,
    bias: { W: { direction: null, reason: '' }, D: { direction: null, reason: '' }, H4: { direction: null, reason: '' }, H1: { direction: null, reason: '' } },
    drawOnLiquidity: '',
    keyLevels: [],
    scenarioPrimary: '',
    scenarioAlternative: '',
    screens: []
  }
  // Only empty fields are filled: inserting a template never overwrites what is already written.
  const labels = new Set(base.keyLevels.map((l) => l.label))
  return {
    ...base,
    drawOnLiquidity: base.drawOnLiquidity || t.drawOnLiquidity,
    scenarioPrimary: base.scenarioPrimary || t.scenarioPrimary,
    scenarioAlternative: base.scenarioAlternative || t.scenarioAlternative,
    keyLevels: [...base.keyLevels, ...t.levelLabels.filter((l) => !labels.has(l)).map((label) => ({ id: newId(), price: null, label }))]
  }
}

/** The plan with the template inserted: its pairs first (filled where empty), then the plan's other pairs. */
export function applyTemplate(plan: DayPlan, t: DayTemplate): DayPlan {
  const pairs = t.pairs.map((tp) => pairFromTemplate(tp, plan.pairs.find((p) => p.pair === tp.pair)))
  const others = plan.pairs.filter((p) => !t.pairs.some((tp) => tp.pair === p.pair))
  const intermarket = [...plan.intermarket]
  for (const i of t.intermarket) if (!intermarket.some((x) => x.instrument === i)) intermarket.push({ instrument: i, read: '', relation: null })
  return { ...plan, pairs: [...pairs, ...others], intermarket, notes: plan.notes || t.notes }
}

/** A new plan for `date`: from the default template, else with `pairs` (e.g. the previous plan's pairs). */
export function newDayPlan(date: string, settings: Pick<Settings, 'dayTemplates' | 'contextInstruments'>, pairs: string[]): DayPlan {
  const def = settings.dayTemplates.find((t) => t.isDefault)
  if (def) {
    const empty = createDayPlan(date, [], [])
    return applyTemplate({ ...empty, intermarket: settings.contextInstruments.map((instrument) => ({ instrument, read: '', relation: null })) }, def)
  }
  return createDayPlan(date, pairs.length ? pairs : ['EURUSD'], settings.contextInstruments)
}
