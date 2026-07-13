"use client"

import { useCallback, useSyncExternalStore } from "react"

const STORAGE_KEY = "open-superforecaster.education.v1"
const PROGRESS_VERSION = 1

type OnboardingProgress = {
  currentStep: number
  completedStepIds: string[]
  answers: Record<string, number>
  completedAt: string | null
  skippedAt: string | null
}

type LessonProgress = {
  completedLessonIds: string[]
  answers: Record<string, number>
  lastLessonId: string | null
}

export type EducationProgress = {
  version: number
  onboarding: OnboardingProgress
  lessons: LessonProgress
}

const DEFAULT_PROGRESS: EducationProgress = {
  version: PROGRESS_VERSION,
  onboarding: {
    currentStep: 0,
    completedStepIds: [],
    answers: {},
    completedAt: null,
    skippedAt: null,
  },
  lessons: {
    completedLessonIds: [],
    answers: {},
    lastLessonId: null,
  },
}

const subscribers = new Set<() => void>()
let cachedSerialized: string | null | undefined
let cachedProgress = DEFAULT_PROGRESS

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finiteNonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function answerRecord(value: unknown) {
  if (!isRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] >= 0,
    ),
  )
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null
}

export function normalizeEducationProgress(value: unknown): EducationProgress {
  if (!isRecord(value) || value.version !== PROGRESS_VERSION) return DEFAULT_PROGRESS

  const onboarding = isRecord(value.onboarding) ? value.onboarding : {}
  const lessons = isRecord(value.lessons) ? value.lessons : {}

  return {
    version: PROGRESS_VERSION,
    onboarding: {
      currentStep: finiteNonNegativeInteger(onboarding.currentStep, 0),
      completedStepIds: stringArray(onboarding.completedStepIds),
      answers: answerRecord(onboarding.answers),
      completedAt: nullableString(onboarding.completedAt),
      skippedAt: nullableString(onboarding.skippedAt),
    },
    lessons: {
      completedLessonIds: stringArray(lessons.completedLessonIds),
      answers: answerRecord(lessons.answers),
      lastLessonId: nullableString(lessons.lastLessonId),
    },
  }
}

function readProgress() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === cachedSerialized) return cachedProgress

    cachedSerialized = stored
    cachedProgress = stored ? normalizeEducationProgress(JSON.parse(stored)) : DEFAULT_PROGRESS
    return cachedProgress
  } catch {
    cachedSerialized = null
    cachedProgress = DEFAULT_PROGRESS
    return DEFAULT_PROGRESS
  }
}

function writeProgress(progress: EducationProgress) {
  const serialized = JSON.stringify(progress)
  cachedSerialized = serialized
  cachedProgress = progress

  try {
    window.localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    // Learning remains usable in restricted/private storage environments.
  }

  subscribers.forEach((subscriber) => subscriber())
}

function subscribeToProgress(callback: () => void) {
  subscribers.add(callback)

  function syncFromAnotherTab(event: StorageEvent) {
    if (event.key !== STORAGE_KEY) return
    cachedSerialized = undefined
    callback()
  }

  window.addEventListener("storage", syncFromAnotherTab)
  return () => {
    subscribers.delete(callback)
    window.removeEventListener("storage", syncFromAnotherTab)
  }
}

function getServerSnapshot() {
  return DEFAULT_PROGRESS
}

function subscribeToHydration() {
  return () => undefined
}

export function useEducationProgress() {
  const progress = useSyncExternalStore(subscribeToProgress, readProgress, getServerSnapshot)
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false)

  const update = useCallback((updater: (current: EducationProgress) => EducationProgress) => {
    writeProgress(updater(readProgress()))
  }, [])

  const setOnboardingStep = useCallback(
    (step: number) => {
      update((current) => ({
        ...current,
        onboarding: { ...current.onboarding, currentStep: Math.max(0, step) },
      }))
    },
    [update],
  )

  const answerOnboardingStep = useCallback(
    (stepId: string, answer: number) => {
      update((current) => ({
        ...current,
        onboarding: {
          ...current.onboarding,
          answers: { ...current.onboarding.answers, [stepId]: answer },
        },
      }))
    },
    [update],
  )

  const completeOnboardingStep = useCallback(
    (stepId: string) => {
      update((current) => ({
        ...current,
        onboarding: {
          ...current.onboarding,
          completedStepIds: current.onboarding.completedStepIds.includes(stepId)
            ? current.onboarding.completedStepIds
            : [...current.onboarding.completedStepIds, stepId],
        },
      }))
    },
    [update],
  )

  const completeOnboarding = useCallback(() => {
    update((current) => ({
      ...current,
      onboarding: { ...current.onboarding, completedAt: new Date().toISOString(), skippedAt: null },
    }))
  }, [update])

  const skipOnboarding = useCallback(() => {
    update((current) => ({
      ...current,
      onboarding: { ...current.onboarding, skippedAt: new Date().toISOString() },
    }))
  }, [update])

  const resetOnboarding = useCallback(() => {
    update((current) => ({ ...current, onboarding: DEFAULT_PROGRESS.onboarding }))
  }, [update])

  const setLastLesson = useCallback(
    (lessonId: string) => {
      update((current) => ({
        ...current,
        lessons: { ...current.lessons, lastLessonId: lessonId },
      }))
    },
    [update],
  )

  const answerLesson = useCallback(
    (lessonId: string, answer: number, correct: boolean) => {
      update((current) => ({
        ...current,
        lessons: {
          ...current.lessons,
          answers: { ...current.lessons.answers, [lessonId]: answer },
          completedLessonIds:
            correct && !current.lessons.completedLessonIds.includes(lessonId)
              ? [...current.lessons.completedLessonIds, lessonId]
              : current.lessons.completedLessonIds,
          lastLessonId: lessonId,
        },
      }))
    },
    [update],
  )

  const resetLessons = useCallback(() => {
    update((current) => ({ ...current, lessons: DEFAULT_PROGRESS.lessons }))
  }, [update])

  return {
    progress,
    hydrated,
    setOnboardingStep,
    answerOnboardingStep,
    completeOnboardingStep,
    completeOnboarding,
    skipOnboarding,
    resetOnboarding,
    setLastLesson,
    answerLesson,
    resetLessons,
  }
}
