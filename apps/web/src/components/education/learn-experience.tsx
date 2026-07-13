"use client"

import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import {
  ArrowRight,
  BookMarked,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Compass,
  ListChecks,
  RotateCcw,
  Scale,
  Sparkles,
  Target,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"

import { EducationExercise } from "./education-exercise"
import { EducationHeader } from "./education-header"
import { COURSE_LESSONS, FORECASTING_GLOSSARY } from "./education-curriculum"
import { useEducationProgress } from "./education-progress"

export function LearnExperience() {
  const [openLessonId, setOpenLessonId] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [notice, setNotice] = useState("")
  const lessonRefs = useRef<Record<string, HTMLElement | null>>({})
  const { progress, hydrated, setLastLesson, answerLesson, resetLessons } = useEducationProgress()

  const completedCount = progress.lessons.completedLessonIds.length
  const coursePercent = Math.round((completedCount / COURSE_LESSONS.length) * 100)
  const nextLesson = useMemo(
    () => COURSE_LESSONS.find((lesson) => !progress.lessons.completedLessonIds.includes(lesson.id)) ?? COURSE_LESSONS[0],
    [progress.lessons.completedLessonIds],
  )
  const activeLessonId = openLessonId ?? progress.lessons.lastLessonId ?? nextLesson.id

  function toggleLesson(lessonId: string) {
    const opening = activeLessonId !== lessonId
    setOpenLessonId(opening ? lessonId : "")
    setConfirmReset(false)
    setNotice("")
    if (opening) setLastLesson(lessonId)
  }

  function resumeCourse() {
    const lessonId = nextLesson.id
    setOpenLessonId(lessonId)
    setLastLesson(lessonId)
    window.requestAnimationFrame(() => {
      lessonRefs.current[lessonId]?.scrollIntoView({ block: "start" })
      const trigger = lessonRefs.current[lessonId]?.querySelector<HTMLButtonElement>("[data-lesson-trigger]")
      trigger?.focus()
    })
  }

  function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true)
      setNotice("Press reset once more to clear course answers on this device.")
      return
    }

    resetLessons()
    setConfirmReset(false)
    setOpenLessonId(COURSE_LESSONS[0]?.id ?? null)
    setNotice("Course progress reset.")
  }

  if (!hydrated) {
    return <LearnLoading />
  }

  return (
    <main className="relative min-h-svh overflow-hidden">
      <LearnBackdrop />
      <div className="relative">
        <EducationHeader
          section="Forecasting field guide"
          title="Learn the craft. Practice the judgment. Keep the score."
          description="A concise, interactive curriculum based on the habits behind superforecasting—not a promise of certainty, and not a substitute for an earned track record."
          backHref="/onboarding"
          backLabel="Onboarding"
          actions={
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
              <Target aria-hidden="true" />
              New forecast
            </Button>
          }
        />

        <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
          <section aria-labelledby="course-progress" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="rounded-2xl border border-border/80 bg-card/78 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-primary">Your field record</p>
                  <h2 id="course-progress" className="mt-2 text-2xl font-bold tracking-[-0.02em]">Master the full forecasting loop</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Each lesson ends with a transfer check. Correct answers complete the lesson; progress is stored locally and never enters a forecast.
                  </p>
                </div>
                <div className="flex size-20 shrink-0 flex-col items-center justify-center rounded-full border border-primary/30 bg-primary/8 text-center shadow-inner shadow-black/20">
                  <span className="text-xl font-bold tabular-nums">{coursePercent}%</span>
                  <span className="text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">complete</span>
                </div>
              </div>

              <Progress className="mt-6" value={coursePercent} aria-label={`Course ${coursePercent}% complete`}>
                <ProgressLabel>{completedCount} of {COURSE_LESSONS.length} lessons</ProgressLabel>
                <ProgressValue>{() => `${coursePercent}%`}</ProgressValue>
              </Progress>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <Button onClick={resumeCourse}>
                  <Compass aria-hidden="true" />
                  {completedCount > 0 ? "Continue course" : "Begin course"}
                  <ArrowRight aria-hidden="true" />
                </Button>
                <Button variant={confirmReset ? "destructive" : "ghost"} onClick={handleReset}>
                  <RotateCcw aria-hidden="true" />
                  {confirmReset ? "Confirm reset" : "Reset progress"}
                </Button>
              </div>
              <p aria-live="polite" className="mt-3 min-h-5 text-xs text-forecast">{notice}</p>
            </div>

            <aside className="rounded-2xl border border-forecast/25 bg-forecast/7 p-5 sm:p-6">
              <Sparkles aria-hidden="true" className="size-5 text-forecast" />
              <p className="mt-4 text-[0.68rem] font-bold uppercase tracking-[0.2em] text-forecast">The core loop</p>
              <ol className="mt-3 grid gap-2 text-sm leading-5">
                {["Triage the question", "Start outside, then move inside", "Make private numerical judgments", "Update on diagnostic evidence", "Resolve, score, and review"].map((item, index) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-forecast/30 text-[0.62rem] font-bold tabular-nums text-forecast">
                      {index + 1}
                    </span>
                    {item}
                  </li>
                ))}
              </ol>
            </aside>
          </section>

          <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_310px]">
            <section aria-labelledby="curriculum-heading">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-primary">Curriculum</p>
                  <h2 id="curriculum-heading" className="mt-2 text-2xl font-bold tracking-[-0.02em]">Ten field lessons</h2>
                </div>
                <p className="hidden text-xs text-muted-foreground sm:block">About 75 minutes total</p>
              </div>

              <div className="mt-4 grid gap-3">
                {COURSE_LESSONS.map((lesson, index) => {
                  const open = activeLessonId === lesson.id
                  const completed = progress.lessons.completedLessonIds.includes(lesson.id)
                  const selected = progress.lessons.answers[lesson.id]

                  return (
                    <article
                      key={lesson.id}
                      ref={(element) => { lessonRefs.current[lesson.id] = element }}
                      className={`scroll-mt-6 overflow-hidden rounded-xl border bg-card/78 shadow-xl shadow-black/10 backdrop-blur-lg ${
                        open ? "border-primary/35" : "border-border/80"
                      }`}
                    >
                      <h3>
                        <button
                          type="button"
                          data-lesson-trigger
                          aria-expanded={open}
                          aria-controls={`lesson-panel-${lesson.id}`}
                          onClick={() => toggleLesson(lesson.id)}
                          className="flex w-full items-start gap-3 p-4 text-left transition-[background-color,color] duration-150 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none sm:items-center sm:p-5"
                        >
                          <span
                            className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-[0.65rem] font-bold tabular-nums sm:mt-0 ${
                              completed ? "border-success/40 bg-success/10 text-success" : open ? "border-primary/45 text-primary" : "border-border text-muted-foreground"
                            }`}
                          >
                            {completed ? <Check aria-hidden="true" className="size-4" /> : String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="font-bold leading-5">{lesson.title}</span>
                              <span className="flex items-center gap-1 text-[0.68rem] text-muted-foreground">
                                <Clock3 aria-hidden="true" className="size-3" />
                                {lesson.duration}
                              </span>
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground sm:text-sm">{lesson.promise}</span>
                          </span>
                          <ChevronDown
                            aria-hidden="true"
                            className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none sm:mt-0 ${open ? "rotate-180" : ""}`}
                          />
                        </button>
                      </h3>

                      {open ? (
                        <div id={`lesson-panel-${lesson.id}`} className="border-t border-border/70 p-4 sm:p-6">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{lesson.chapter}</Badge>
                            {completed ? (
                              <Badge className="border-success/30 bg-success/10 text-success" variant="outline">
                                <Check aria-hidden="true" /> Mastered
                              </Badge>
                            ) : null}
                          </div>

                          <blockquote className="mt-5 border-l-2 border-forecast/60 pl-4 text-lg font-bold leading-7 text-foreground">
                            {lesson.mentalModel}
                          </blockquote>

                          <div className="mt-6 grid gap-3 md:grid-cols-3">
                            {lesson.concepts.map((concept) => (
                              <div key={concept.title} className="rounded-lg border border-border/70 bg-background/45 p-4">
                                <h4 className="font-bold">{concept.title}</h4>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">{concept.body}</p>
                              </div>
                            ))}
                          </div>

                          <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
                            <div className="flex items-center gap-2">
                              <BookMarked aria-hidden="true" className="size-4 text-primary" />
                              <p className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-primary">Worked example</p>
                            </div>
                            <h4 className="mt-3 text-base font-bold leading-6">{lesson.workedExample.question}</h4>
                            <ol className="mt-4 grid gap-2.5">
                              {lesson.workedExample.steps.map((step, stepIndex) => (
                                <li key={step} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                                  <span className="mt-0.5 font-bold tabular-nums text-foreground">{stepIndex + 1}.</span>
                                  {step}
                                </li>
                              ))}
                            </ol>
                            <p className="mt-4 border-t border-primary/15 pt-4 text-sm font-bold leading-6">{lesson.workedExample.conclusion}</p>
                          </div>

                          <div className="mt-6">
                            <EducationExercise
                              id={`lesson-${lesson.id}`}
                              exercise={lesson.exercise}
                              selected={selected}
                              onSelect={(answer) => {
                                answerLesson(lesson.id, answer, answer === lesson.exercise.correctIndex)
                                setNotice("")
                              }}
                              legend="Transfer check"
                            />
                          </div>

                          <div className="mt-6 border-t border-border/70 pt-5">
                            <div className="flex items-center gap-2">
                              <ListChecks aria-hidden="true" className="size-4 text-primary" />
                              <h4 className="text-xs font-bold uppercase tracking-[0.18em]">Use it in the field</h4>
                            </div>
                            <ul className="mt-3 flex flex-wrap gap-2">
                              {lesson.fieldChecklist.map((item) => (
                                <li key={item} className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs text-muted-foreground">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </section>

            <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
              <section className="rounded-xl border border-border/80 bg-card/75 p-5" aria-labelledby="quick-reference-heading">
                <Scale aria-hidden="true" className="size-5 text-primary" />
                <h2 id="quick-reference-heading" className="mt-4 font-bold">Forecasting quick reference</h2>
                <ol className="mt-4 grid gap-3">
                  {[
                    "Triage before quantifying",
                    "Freeze the resolution contract",
                    "Record a private prior",
                    "Start from a base rate",
                    "Decompose and check dependence",
                    "Make the opposite case",
                    "Update on diagnostic evidence",
                    "Keep independent estimates separate",
                    "Resolve and score every eligible case",
                    "Test lessons on future cases",
                  ].map((rule, index) => (
                    <li key={rule} className="flex gap-3 text-xs leading-5 text-muted-foreground">
                      <span className="font-bold tabular-nums text-foreground">{String(index + 1).padStart(2, "0")}</span>
                      {rule}
                    </li>
                  ))}
                </ol>
              </section>

              <section className="rounded-xl border border-border/80 bg-card/75 p-5" aria-labelledby="glossary-heading">
                <h2 id="glossary-heading" className="font-bold">Field glossary</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Precise words for precise judgment.</p>
                <div className="mt-4 grid gap-2">
                  {FORECASTING_GLOSSARY.map(([term, definition]) => (
                    <details key={term} className="group rounded-lg border border-border/70 bg-background/40 open:border-primary/25">
                      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        <span className="flex items-center justify-between gap-2">
                          {term}
                          <Circle aria-hidden="true" className="size-1.5 fill-muted-foreground text-muted-foreground group-open:fill-primary group-open:text-primary" />
                        </span>
                      </summary>
                      <p className="border-t border-border/60 px-3 py-3 text-xs leading-5 text-muted-foreground">{definition}</p>
                    </details>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-success/25 bg-success/6 p-5" aria-labelledby="finish-heading">
                <Target aria-hidden="true" className="size-5 text-success" />
                <h2 id="finish-heading" className="mt-4 font-bold">Practice on a real question</h2>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  The course is a map. Skill comes from making explicit forecasts, resolving them, and reviewing the full record.
                </p>
                <Button className="mt-4 w-full" nativeButton={false} render={<Link href="/" />}>
                  New forecast
                  <ArrowRight aria-hidden="true" />
                </Button>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </main>
  )
}

function LearnBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -right-48 top-10 size-[34rem] rounded-full bg-primary/7 blur-3xl" />
      <div className="absolute bottom-[18%] -left-52 size-[30rem] rounded-full bg-forecast/4 blur-3xl" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
    </div>
  )
}

function LearnLoading() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
        <span className="size-2 rounded-full bg-primary" />
        Restoring your field-course progress
      </div>
    </main>
  )
}
