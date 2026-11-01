/* Stepper — spec §5.2. Props: steps [{id,label}], currentIndex, large (default
 * true per task: large stepper), onStepClick optional. Uses ol + aria-current. */
import './Stepper.css';

export interface StepItem { id: string; label: string; }
export interface StepperProps {
  steps: StepItem[]; currentIndex: number; large?: boolean;
  onStepClick?: (index: number) => void; ariaLabel?: string;
}

export function Stepper({ steps, currentIndex, large = true, onStepClick, ariaLabel = 'Progress' }: StepperProps) {
  const currentLabel = steps[currentIndex]?.label;
  return (
    <div className="z-stepper-wrap">
    <ol className={`z-stepper${large ? ' z-stepper--large' : ''}`} aria-label={ariaLabel}>
      {steps.map((s, i) => {
        const done = i < currentIndex; const current = i === currentIndex;
        const content = (<><span className="z-stepper__dot" aria-hidden="true">{done ? '✓' : i + 1}</span><span className="z-label z-stepper__label">{s.label}</span></>);
        return (
          <li key={s.id}>
            {onStepClick ? (
              <button type="button" className={`z-stepper__step${done ? ' z-stepper__step--done' : ''}`} aria-current={current ? 'step' : undefined} onClick={() => onStepClick(i)}>{content}</button>
            ) : (
              <span className={`z-stepper__step${done ? ' z-stepper__step--done' : ''}`} aria-current={current ? 'step' : undefined}>{content}</span>
            )}
          </li>
        );
      })}
    </ol>
    {/* Phones show dots only; this line names the current step there. */}
    {currentLabel && <p className="z-stepper__caption" aria-hidden="true">Step {currentIndex + 1} of {steps.length} · {currentLabel}</p>}
    </div>
  );
}
