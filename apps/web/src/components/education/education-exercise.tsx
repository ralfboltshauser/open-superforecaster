"use client"

import { Check, CircleAlert } from "lucide-react"

import type { EducationExercise as EducationExerciseData } from "./education-curriculum"

type EducationExerciseProps = {
  id: string
  exercise: EducationExerciseData
  selected: number | undefined
  onSelect: (answer: number) => void
  legend?: string
}

export function EducationExercise({ id, exercise, selected, onSelect, legend = "Check your judgment" }: EducationExerciseProps) {
  const answered = selected !== undefined
  const correct = selected === exercise.correctIndex
  const selectedOption = selected === undefined ? null : exercise.options[selected]

  return (
    <fieldset className="rounded-xl border border-border/80 bg-background/55 p-4 sm:p-5">
      <legend className="px-2 text-[0.68rem] font-bold uppercase tracking-[0.22em] text-primary">{legend}</legend>
      <p className="max-w-2xl text-base font-bold leading-6 text-foreground">{exercise.prompt}</p>

      <div className="mt-4 grid gap-2.5">
        {exercise.options.map((option, index) => {
          const isSelected = selected === index
          const revealCorrect = answered && index === exercise.correctIndex
          const revealWrong = isSelected && !correct

          return (
            <label
              key={option.label}
              className={`group flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-[border-color,background-color,color] duration-150 motion-reduce:transition-none ${
                revealCorrect
                  ? "border-success/55 bg-success/8"
                  : revealWrong
                    ? "border-destructive/55 bg-destructive/8"
                    : isSelected
                      ? "border-primary/60 bg-primary/10"
                      : "border-border bg-card/45 hover:border-primary/30 hover:bg-muted/45"
              }`}
            >
              <input
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                type="radio"
                name={`education-exercise-${id}`}
                value={index}
                checked={isSelected}
                onChange={() => onSelect(index)}
              />
              <span className="min-w-0 flex-1 text-sm leading-5">{option.label}</span>
              {revealCorrect ? <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : null}
              {revealWrong ? <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" /> : null}
            </label>
          )
        })}
      </div>

      <div aria-live="polite" className="mt-4 min-h-12">
        {answered && selectedOption ? (
          <div
            className={`rounded-lg border px-3.5 py-3 text-sm leading-5 ${
              correct
                ? "border-success/35 bg-success/8 text-foreground"
                : "border-destructive/30 bg-destructive/8 text-foreground"
            }`}
          >
            <p className="font-bold">{correct ? "That’s the forecasting move." : "Not quite. Inspect the boundary."}</p>
            <p className="mt-1 text-muted-foreground">{selectedOption.explanation}</p>
            {!correct ? (
              <p className="mt-2 text-muted-foreground">
                Best answer: <span className="text-foreground">{exercise.options[exercise.correctIndex]?.label}</span>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="pt-2 text-xs text-muted-foreground">Choose the answer that produces the most testable, honest forecast.</p>
        )}
      </div>
    </fieldset>
  )
}
