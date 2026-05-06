'use client'

import { useState, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Step {
  type: 'warmup' | 'interval' | 'recovery' | 'cooldown' | 'steady'
  description: string
  duration_sec: number
  zone: number | null
  repeats: number
}

interface Workout {
  name: string
  day: string
  sport: 'run' | 'cycle' | 'swim' | 'other'
  duration_min: number
  notes: string
  steps: Step[]
}

type StatusKind = 'idle' | 'loading' | 'ok' | 'err'

// ── Garmin JSON converter ─────────────────────────────────────────────────────

function toGarminJSON(w: Workout) {
  // Sport type IDs from Garmin Connect reverse engineering
  const SPORTS: Record<string, any> = {
    run:   { sportTypeId: 1,  sportTypeKey: 'running',      displayOrder: 1  },
    cycle: { sportTypeId: 2,  sportTypeKey: 'cycling',      displayOrder: 2  },
    swim:  { sportTypeId: 4,  sportTypeKey: 'lap_swimming', displayOrder: 4  },
    other: { sportTypeId: 17, sportTypeKey: 'other',        displayOrder: 17 },
  }
  const STEP_TYPES: Record<string, any> = {
    warmup:   { stepTypeId: 1, stepTypeKey: 'warmup',   displayOrder: 1 },
    cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown', displayOrder: 2 },
    interval: { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 },
    recovery: { stepTypeId: 4, stepTypeKey: 'recovery', displayOrder: 4 },
    steady:   { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 },
    rest:     { stepTypeId: 4, stepTypeKey: 'recovery', displayOrder: 4 },
  }

  const sportType = SPORTS[w.sport] || SPORTS.other
  const workoutSteps: any[] = []
  let ord = 1

  for (const s of (w.steps || [])) {
    const st = STEP_TYPES[s.type] || STEP_TYPES.interval
    const durationSec = Math.round(s.duration_sec || 300)

    const makeStep = (o: number): any => ({
      type: 'ExecutableStepDTO',
      stepId: null,
      stepOrder: o,
      childStepId: null,
      description: null,
      stepType: st,
      endCondition: {
        conditionTypeKey: 'time',
        conditionTypeId: 2,
        displayOrder: 2,
        displayable: true,
      },
      endConditionValue: durationSec,
      endConditionCompare: null,
      endConditionZone: null,
      preferredEndConditionUnit: null,
      targetType: {
        workoutTargetTypeId: s.zone ? 4 : 1,
        workoutTargetTypeKey: s.zone ? 'heart.rate.zone' : 'no.target',
        displayOrder: s.zone ? 4 : 1,
      },
      targetValueOne: null,
      targetValueTwo: null,
      zoneNumber: s.zone || null,
    })

    if ((s.repeats || 1) > 1) {
      workoutSteps.push({
        type: 'RepeatGroupDTO',
        stepId: null,
        stepOrder: ord++,
        childStepId: 1,
        numberOfIterations: s.repeats,
        smartRepeat: false,
        endCondition: {
          conditionTypeKey: 'iterations',
          conditionTypeId: 7,
          displayOrder: 7,
          displayable: true,
        },
        endConditionValue: s.repeats,
        endConditionCompare: null,
        endConditionZone: null,
        stepType: { stepTypeId: 6, stepTypeKey: 'repeat', displayOrder: 6 },
        workoutSteps: [makeStep(1)],
      })
    } else {
      workoutSteps.push(makeStep(ord++))
    }
  }

  return {
    sportType,
    subSportType: null,
    workoutName: w.day ? `${w.day} \u2013 ${w.name}` : w.name,
    description: w.notes || '',
    estimatedDurationInSecs: (w.duration_min || 30) * 60,
    estimatedDistanceInMeters: null,
    workoutProvider: null,
    workoutSourceId: null,
    isArace: false,
    workoutSegments: [{ segmentOrder: 1, sportType, workoutSteps }],
  }
}


// ── Download ──────────────────────────────────────────────────────────────────

function downloadJSON(filename: string, data: object) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function slug(s: string) {
  return (s || 'workout').replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-')
}

// ── Gemini prompt ─────────────────────────────────────────────────────────────

const PROMPT = `You are a sports coaching assistant. Parse the following weekly training plan into structured workout data.
Return ONLY a valid JSON array — no markdown fences, no explanation, nothing else.

Each workout object must have:
- "name": string (e.g. "Interval Run", "Easy Ride", "Tempo Run")
- "day": string (day of week or label e.g. "Monday")
- "sport": one of "run", "cycle", "swim", "other"
- "duration_min": number (total minutes — sum all steps)
- "notes": string (brief one-line summary)
- "steps": array of:
  - "type": one of "warmup", "interval", "recovery", "cooldown", "steady"
  - "description": string (e.g. "15 mins Z2", "6 mins Z4", "2 mins recovery Z1")
  - "duration_sec": number (seconds — convert from minutes if needed)
  - "zone": number or null (1–5 from Z1/Z2/Z3/Z4/Z5 notation)
  - "repeats": number (1 normally; for sets like "3x10 mins" set repeats=3)

Zones: Z1=recovery, Z2=easy, Z3=tempo, Z4=threshold, Z5=max. Skip rest days.`

// ── Sport imagery ─────────────────────────────────────────────────────────────

const SPORTS = [
  {
    label: 'Swim',
    img: 'https://images.unsplash.com/photo-1530549387789-4c1017266635?w=800&q=85&fit=crop',
    accent: '#5eadd4',
  },
  {
    label: 'Cycle',
    img: 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?w=800&q=85&fit=crop',
    accent: '#e8a84c',
  },
  {
    label: 'Run',
    img: 'https://images.unsplash.com/photo-1571008887538-b36bb32f4571?w=800&q=85&fit=crop',
    accent: '#e07070',
  },
  {
    label: 'Gym',
    img: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=85&fit=crop',
    accent: '#8fca8f',
  },
]

const SPORT_COLORS: Record<string, string> = {
  run:   '#e07070',
  cycle: '#e8a84c',
  swim:  '#5eadd4',
  other: '#8fca8f',
}

const STEP_COLORS: Record<string, string> = {
  warmup:   '#5eadd4',
  interval: '#e07070',
  recovery: '#8fca8f',
  cooldown: '#9b8ab8',
  steady:   '#e8a84c',
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Page() {
  const [apiKey, setApiKey]     = useState('')
  const [planText, setPlanText] = useState('')
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [status, setStatus]     = useState<{ msg: string; kind: StatusKind }>({ msg: '', kind: 'idle' })
  const [done, setDone]         = useState(false)
  const [showKey, setShowKey]   = useState(false)
  const converterRef            = useRef<HTMLDivElement>(null)

  const parse = async () => {
    if (!apiKey || apiKey.length < 10) {
      setStatus({ msg: 'Enter your Gemini API key first', kind: 'err' }); return
    }
    if (!planText.trim()) {
      setStatus({ msg: 'Paste your training plan above', kind: 'err' }); return
    }
    setStatus({ msg: 'Parsing your plan…', kind: 'loading' })

    try {
      let data: any = null
      for (const model of ['gemini-2.5-flash', 'gemini-1.5-flash']) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: PROMPT + '\n\nTraining plan:\n' + planText }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
            }),
          }
        )
        data = await res.json()
        if (data.error?.code === 429 || data.error?.status === 'RESOURCE_EXHAUSTED') continue
        break
      }

      if (data.error) throw new Error(data.error.message)
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const parsed: Workout[] = JSON.parse(raw.replace(/```json|```/g, '').trim())
      if (!parsed.length) throw new Error('No workouts found — try rephrasing your plan')
      setWorkouts(parsed)
      setDone(true)
      setStatus({ msg: '', kind: 'ok' })
    } catch (e: any) {
      setStatus({ msg: e.message || 'Something went wrong', kind: 'err' })
    }
  }

  const reset = () => {
    setDone(false); setWorkouts([]); setPlanText('')
    setStatus({ msg: '', kind: 'idle' })
  }

  const dlOne = (w: Workout) =>
    downloadJSON(`${slug((w.day ? w.day + '-' : '') + w.name)}.json`, toGarminJSON(w))

  const dlAll = () =>
    workouts.forEach((w, i) => setTimeout(() => dlOne(w), i * 200))

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#f5f2ee]" style={{ fontFamily: 'var(--font-body)' }}>

      {/* ── NAV ──────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5"
        style={{ background: 'linear-gradient(to bottom, rgba(10,10,10,0.95) 0%, transparent 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#f5f2ee] flex items-center justify-center">
            <span className="text-[#0a0a0a] text-xs font-black">G</span>
          </div>
          <span className="text-sm font-semibold tracking-wide text-[#f5f2ee]/80">WorkoutSync</span>
        </div>
        <button
          onClick={() => converterRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="text-xs font-semibold px-4 py-2 rounded-full border border-[#f5f2ee]/20 text-[#f5f2ee]/70 hover:border-[#f5f2ee]/50 hover:text-[#f5f2ee] transition-all"
        >
          Get started
        </button>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">

        {/* Sport image grid background */}
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
          {SPORTS.map((s, i) => (
            <div key={i} className="relative overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.img}
                alt={s.label}
                className="w-full h-full object-cover"
                style={{ filter: 'brightness(0.35) saturate(0.8)' }}
              />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(10,10,10,0.4) 0%, transparent 60%)' }} />
              <div className="absolute bottom-6 left-6">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em]"
                  style={{ color: s.accent + 'cc' }}>
                  {s.label}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Centre overlay gradient */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(10,10,10,0.6) 0%, transparent 70%)' }} />

        {/* Hero text */}
        <div className="relative z-10 text-center px-6 max-w-3xl mx-auto">
          <p className="fade-up fade-up-1 text-[11px] font-bold uppercase tracking-[0.25em] text-[#f5f2ee]/40 mb-6">
            Garmin Connect · Training &amp; Planning
          </p>
          <h1
            className="fade-up fade-up-2 text-5xl sm:text-6xl md:text-7xl font-bold leading-[1.05] mb-6"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Your plan.<br />
            <em className="not-italic" style={{ color: '#e07070' }}>Your watch.</em>
          </h1>
          <p className="fade-up fade-up-3 text-base text-[#f5f2ee]/50 leading-relaxed max-w-md mx-auto mb-10">
            Paste any training plan in plain text. Get structured workout files ready to import into Garmin Connect in seconds.
          </p>
          <button
            onClick={() => converterRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="fade-up fade-up-4 group inline-flex items-center gap-3 px-8 py-4 rounded-full font-semibold text-sm transition-all"
            style={{ background: '#f5f2ee', color: '#0a0a0a' }}
          >
            Convert your plan
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </button>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-30">
          <div className="w-px h-10 bg-[#f5f2ee]" style={{ animation: 'fadeUp 2s ease infinite alternate' }} />
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-[#f5f2ee]/5">
        <div className="max-w-3xl mx-auto">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#f5f2ee]/30 mb-12 text-center">How it works</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { n: '01', title: 'Paste your plan', body: 'Write your week\'s training in plain English — any format, any sport.' },
              { n: '02', title: 'AI parses it',    body: 'Gemini reads your plan and converts it into structured Garmin workout data.' },
              { n: '03', title: 'Import & go',     body: 'Download the JSON file and import it into Garmin Connect\'s Training & Planning section.' },
            ].map((step) => (
              <div key={step.n} className="flex flex-col gap-3">
                <span className="text-[11px] font-black tracking-widest" style={{ color: '#e07070' }}>{step.n}</span>
                <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{step.title}</h3>
                <p className="text-sm text-[#f5f2ee]/40 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONVERTER ────────────────────────────────────────────────────── */}
      <section ref={converterRef} className="py-20 px-6 border-t border-[#f5f2ee]/5">
        <div className="max-w-2xl mx-auto">

          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#f5f2ee]/30 mb-3 text-center">Converter</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-12"
            style={{ fontFamily: 'var(--font-display)' }}>
            Paste. Parse. Download.
          </h2>

          {!done ? (
            <div className="space-y-4">

              {/* API key */}
              <div className="rounded-2xl border border-[#f5f2ee]/10 overflow-hidden"
                style={{ background: '#111' }}>
                <div className="flex items-center gap-3 px-5 py-4">
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: apiKey.length > 10 ? '#8fca8f' : '#666' }} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#f5f2ee]/30">Gemini Key</span>
                  </div>
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="AIza..."
                    className="flex-1 min-w-0 bg-transparent text-xs font-mono text-[#f5f2ee]/70 placeholder-[#f5f2ee]/20 outline-none"
                  />
                  <button onClick={() => setShowKey(!showKey)}
                    className="text-[10px] text-[#f5f2ee]/20 hover:text-[#f5f2ee]/50 transition-colors flex-shrink-0">
                    {showKey ? 'hide' : 'show'}
                  </button>
                  {apiKey.length <= 10 && (
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer"
                      className="text-[10px] font-semibold flex-shrink-0 hover:opacity-80 transition-opacity"
                      style={{ color: '#5eadd4' }}>
                      Get free →
                    </a>
                  )}
                </div>
              </div>

              {/* Textarea */}
              <div className="rounded-2xl border border-[#f5f2ee]/10 overflow-hidden"
                style={{ background: '#111' }}>
                <div className="px-5 pt-4 pb-2 border-b border-[#f5f2ee]/5 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#f5f2ee]/30">Training plan</span>
                  <span className="text-[10px] text-[#f5f2ee]/20">Plain text · any format</span>
                </div>
                <textarea
                  value={planText}
                  onChange={e => setPlanText(e.target.value)}
                  rows={10}
                  placeholder={`Monday: Run\nWarm up 10 mins Z2, 6×5 mins Z4 with 2 mins Z1 recovery, cool down 10 mins Z2\n\nWednesday: Cycle\n20 mins Z2, 3×10 mins Z3 with 5 mins recovery, 15 mins Z2\n\nThursday: Easy run 45 mins Z2\n\nSaturday: Long run 90 mins Z2\n\nSunday: Swim\n400m warm up, 10×100m hard with 30s rest, 400m cool down`}
                  className="w-full bg-transparent px-5 py-4 text-xs font-mono text-[#f5f2ee]/70 placeholder-[#f5f2ee]/15 outline-none resize-none leading-relaxed"
                />
              </div>

              {/* Error */}
              {status.kind === 'err' && (
                <p className="text-xs font-mono px-1" style={{ color: '#e07070' }}>
                  ✗ {status.msg}
                </p>
              )}

              {/* Submit */}
              <button
                onClick={parse}
                disabled={status.kind === 'loading'}
                className="w-full py-4 rounded-2xl font-bold text-sm tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: '#f5f2ee', color: '#0a0a0a' }}
              >
                {status.kind === 'loading' ? (
                  <span className="flex items-center justify-center gap-3">
                    <span className="w-4 h-4 border-2 border-[#0a0a0a]/20 border-t-[#0a0a0a] rounded-full inline-block"
                      style={{ animation: 'spin 0.8s linear infinite' }} />
                    Parsing with Gemini AI…
                  </span>
                ) : 'Parse workouts →'}
              </button>

            </div>
          ) : (

            /* ── RESULTS ─────────────────────────────────────────────── */
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-[#f5f2ee]/70">
                  {workouts.length} workout{workouts.length !== 1 ? 's' : ''} ready
                </h3>
                <button onClick={dlAll}
                  className="text-xs font-bold px-4 py-2 rounded-full transition-all hover:opacity-80"
                  style={{ background: '#f5f2ee', color: '#0a0a0a' }}>
                  ↓ Download all
                </button>
              </div>

              <div className="space-y-3">
                {workouts.map((w, i) => (
                  <div key={i} className="rounded-2xl border overflow-hidden transition-all hover:border-[#f5f2ee]/20"
                    style={{ background: '#111', borderColor: SPORT_COLORS[w.sport] + '30' }}>

                    {/* Card header */}
                    <div className="flex items-center justify-between gap-4 px-5 py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: SPORT_COLORS[w.sport] }} />
                        <div className="min-w-0">
                          {w.day && (
                            <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-0.5"
                              style={{ color: SPORT_COLORS[w.sport] + 'aa' }}>
                              {w.day}
                            </p>
                          )}
                          <p className="text-sm font-semibold truncate"
                            style={{ fontFamily: 'var(--font-display)' }}>
                            {w.name}
                          </p>
                          <p className="text-[11px] text-[#f5f2ee]/30 mt-0.5">{w.duration_min} min · {w.notes}</p>
                        </div>
                      </div>
                      <button onClick={() => dlOne(w)}
                        className="flex-shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all hover:opacity-80"
                        style={{ borderColor: SPORT_COLORS[w.sport] + '50', color: SPORT_COLORS[w.sport] }}>
                        ↓ JSON
                      </button>
                    </div>

                    {/* Steps */}
                    {w.steps?.length > 0 && (
                      <div className="px-5 pb-4 flex flex-wrap gap-1.5">
                        {w.steps.map((s, j) => (
                          <span key={j}
                            className="text-[10px] font-mono px-2.5 py-1 rounded-lg"
                            style={{
                              background: STEP_COLORS[s.type] + '15',
                              color: STEP_COLORS[s.type] + 'cc',
                              border: `1px solid ${STEP_COLORS[s.type]}25`,
                            }}>
                            {s.description}{s.repeats > 1 ? ` ×${s.repeats}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Import instructions */}
              <div className="rounded-2xl border border-[#f5f2ee]/8 px-6 py-5 space-y-3"
                style={{ background: '#0f0f0f' }}>
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#f5f2ee]/40">
                  How to import into Training &amp; Planning
                </p>
                <ol className="space-y-2">
                  {[
                    'Download the .json file above',
                    <>Go to <a href="https://connect.garmin.com" target="_blank" rel="noreferrer" className="underline" style={{ color: '#5eadd4' }}>connect.garmin.com</a> and log in</>,
                    'Import the .json file into Training & Planning',
                    'Sync your watch — the workout will appear on your device',
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3 text-xs text-[#f5f2ee]/40 leading-relaxed">
                      <span className="flex-shrink-0 font-bold" style={{ color: '#e07070' }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <button onClick={reset}
                className="text-xs text-[#f5f2ee]/25 hover:text-[#f5f2ee]/50 transition-colors">
                ← Parse another plan
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── SPORT STRIP ──────────────────────────────────────────────────── */}
      <section className="border-t border-[#f5f2ee]/5">
        <div className="grid grid-cols-4 h-48 sm:h-64">
          {SPORTS.map((s, i) => (
            <div key={i} className="relative overflow-hidden group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.img} alt={s.label}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                style={{ filter: 'brightness(0.4) saturate(0.7)' }} />
              <div className="absolute inset-0 flex items-end p-5">
                <span className="text-sm font-bold uppercase tracking-[0.15em]"
                  style={{ color: s.accent }}>
                  {s.label}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#f5f2ee]/5 px-8 py-8 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-[#f5f2ee] flex items-center justify-center">
            <span className="text-[#0a0a0a] text-[10px] font-black">G</span>
          </div>
          <span className="text-xs text-[#f5f2ee]/20">WorkoutSync</span>
        </div>
        <p className="text-[11px] text-[#f5f2ee]/15">
          Built with Claude · All processing happens in your browser · No data stored
        </p>
      </footer>

      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
