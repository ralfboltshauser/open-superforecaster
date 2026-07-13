"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Lightbulb,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  Target,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"

import { EducationExercise } from "./education-exercise"
import { EducationHeader } from "./education-header"
import { ONBOARDING_STEPS } from "./education-curriculum"
import { useEducationProgress } from "./education-progress"

export function OnboardingExperience() {
  const router = useRouter()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [notice, setNotice] = useState("")
  const {
    progress,
    hydrated,
    setOnboardingStep,
    answerOnboardingStep,
    completeOnboardingStep,
    completeOnboarding,
    skipOnboarding,
    resetOnboarding,
  } = useEducationProgress()

  const currentIndex = Math.min(progress.onboarding.currentStep, ONBOARDING_STEPS.length - 1)
  const step = ONBOARDING_STEPS[currentIndex]
  const selectedAnswer = step ? progress.onboarding.answers[step.id] : undefined
  const completedCount = progress.onboarding.completedStepIds.length
  const progressPercent = Math.round((completedCount / ONBOARDING_STEPS.length) * 100)
  const isLast = currentIndex === ONBOARDING_STEPS.length - 1

  function focusLessonHeading() {
    window.requestAnimationFrame(() => headingRef.current?.focus())
  }

  function visitStep(index: number) {
    setNotice("")
    setOnboardingStep(index)
    focusLessonHeading()
  }

  function continueOnboarding() {
    if (!step) return
    if (selectedAnswer === undefined) {
      setNotice("Choose an answer before continuing. You can still skip the onboarding at any time.")
      return
    }

    completeOnboardingStep(step.id)
    setNotice("")

    if (isLast) {
      completeOnboarding()
      router.push("/")
      return
    }

    setOnboardingStep(currentIndex + 1)
    focusLessonHeading()
  }

  function handleSkip() {
    skipOnboarding()
    router.push("/")
  }

  function handleReset() {
    resetOnboarding()
    setNotice("Onboarding progress reset.")
    focusLessonHeading()
  }

  if (!hydrated || !step) {
    return <EducationLoading label="Restoring your onboarding progress" />
  }

  return (
    <main className="relative min-h-svh overflow-hidden">
      <EducationBackdrop />
      <div className="relative">
        <EducationHeader
          section="Forecasting foundations"
          title="Build better judgment before the first prediction."
          description="Seven short field lessons teach the habits behind superforecasting. Your progress stays on this device; you can leave and resume at any time."
          actions={
            <Button variant="ghost" size="sm" onClick={handleSkip}>
              <SkipForward aria-hidden="true" />
              Skip for now
            </Button>
          }
        />

        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-8 lg:py-8">
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-xl border border-border/80 bg-card/72 p-4 shadow-2xl shadow-black/15 backdrop-blur-xl">
              <Progress value={progressPercent} aria-label={`Onboarding ${progressPercent}% complete`}>
                <ProgressLabel>Field course</ProgressLabel>
                <ProgressValue>{() => `${completedCount}/${ONBOARDING_STEPS.length}`}</ProgressValue>
              </Progress>

              <nav aria-label="Onboarding lessons" className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:grid lg:overflow-visible">
                {ONBOARDING_STEPS.map((item, index) => {
                  const active = index === currentIndex
                  const completed = progress.onboarding.completedStepIds.includes(item.id)

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? "step" : undefined}
                      onClick={() => visitStep(index)}
                      className={`flex min-w-52 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-[border-color,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none lg:min-w-0 ${
                        active
                          ? "border-primary/45 bg-primary/10 text-foreground"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/45 hover:text-foreground"
                      }`}
                    >
                      <span
                        className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[0.65rem] font-bold tabular-nums ${
                          completed ? "border-success/45 bg-success/10 text-success" : active ? "border-primary/45 text-primary" : "border-border"
                        }`}
                      >
                        {completed ? <Check aria-hidden="true" className="size-3.5" /> : item.number}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-bold">{item.eyebrow}</span>
                        <span className="mt-0.5 block text-[0.68rem] text-muted-foreground">Lesson {index + 1}</span>
                      </span>
                    </button>
                  )
                })}
              </nav>

              <div className="mt-5 hidden border-t border-border/70 pt-4 lg:block">
                <p className="text-xs leading-5 text-muted-foreground">
                  No account or provider is required. This course teaches the method; it does not configure agents.
                </p>
                {(progress.onboarding.completedAt || progress.onboarding.skippedAt) ? (
                  <Button className="mt-3 w-full" variant="ghost" size="sm" onClick={handleReset}>
                    <RotateCcw aria-hidden="true" />
                    Start over
                  </Button>
                ) : null}
              </div>
            </div>
          </aside>

          <section aria-labelledby="lesson-heading" className="min-w-0">
            <article className="overflow-hidden rounded-2xl border border-border/90 bg-card/80 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="grid border-b border-border/70 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="p-5 sm:p-8 lg:p-10">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Lesson {currentIndex + 1} of {ONBOARDING_STEPS.length}</Badge>
                    {progress.onboarding.completedStepIds.includes(step.id) ? (
                      <Badge className="border-success/30 bg-success/10 text-success" variant="outline">
                        <Check aria-hidden="true" /> Completed
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-7 text-[0.68rem] font-bold uppercase tracking-[0.24em] text-primary">{step.eyebrow}</p>
                  <h2
                    ref={headingRef}
                    id="lesson-heading"
                    tabIndex={-1}
                    className="mt-3 max-w-3xl text-2xl font-bold leading-tight tracking-[-0.025em] outline-none sm:text-3xl lg:text-4xl"
                  >
                    {step.title}
                  </h2>
                  <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">{step.summary}</p>

                  <ul className="mt-7 grid gap-3" aria-label="Key principles">
                    {step.principles.map((principle) => (
                      <li key={principle} className="flex items-start gap-3 text-sm leading-6">
                        <span className="mt-2 flex size-4 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/10">
                          <Circle aria-hidden="true" className="size-1.5 fill-primary text-primary" />
                        </span>
                        <span>{principle}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <aside className="border-t border-border/70 bg-muted/20 p-5 sm:p-7 lg:border-l lg:border-t-0">
                  <Lightbulb aria-hidden="true" className="size-5 text-forecast" />
                  <p className="mt-5 text-[0.68rem] font-bold uppercase tracking-[0.2em] text-muted-foreground">{step.fieldNote.label}</p>
                  <h3 className="mt-2 text-lg font-bold leading-6">{step.fieldNote.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.fieldNote.body}</p>
                  <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
                    <ShieldCheck aria-hidden="true" className="mb-2 size-4 text-primary" />
                    The system’s probability is evidence, not authority. Your independent judgment remains visible and separate.
                  </div>
                </aside>
              </div>

              <div className="p-5 sm:p-8 lg:p-10">
                <EducationExercise
                  id={`onboarding-${step.id}`}
                  exercise={step.exercise}
                  selected={selectedAnswer}
                  onSelect={(answer) => {
                    answerOnboardingStep(step.id, answer)
                    setNotice("")
                  }}
                />

                <p aria-live="polite" className="mt-3 min-h-5 text-sm text-forecast">
                  {notice}
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
                  <Button variant="ghost" onClick={() => visitStep(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0}>
                    <ChevronLeft aria-hidden="true" />
                    Previous
                  </Button>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button variant="outline" nativeButton={false} render={<Link href="/learn" />}>
                      <BookOpen aria-hidden="true" />
                      Explore full course
                    </Button>
                    <Button onClick={continueOnboarding}>
                      {isLast ? (
                        <>
                          <Target aria-hidden="true" />
                          Start forecasting
                          <ArrowRight aria-hidden="true" />
                        </>
                      ) : (
                        <>
                          Continue
                          <ChevronRight aria-hidden="true" />
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </article>

            <noscript>
              <p className="mt-4 rounded-lg border border-forecast/30 bg-forecast/10 p-4 text-sm">
                JavaScript is required to save course progress and run the exercises.
              </p>
            </noscript>
          </section>
        </div>
      </div>
    </main>
  )
}

function EducationBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-primary/8 blur-3xl" />
      <div className="absolute -bottom-52 right-0 size-[30rem] rounded-full bg-success/5 blur-3xl" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
    </div>
  )
}

function EducationLoading({ label }: { label: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
        <span className="size-2 rounded-full bg-primary" />
        {label}
      </div>
    </main>
  )
}
