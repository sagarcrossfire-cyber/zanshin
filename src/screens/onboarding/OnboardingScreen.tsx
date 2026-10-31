// Onboarding — spec §5.2. Steps 0–5 (Welcome, Profile, Time, History,
// Calibration, Placement). Every field writes through to the profile table
// immediately, so a reload resumes at the same step with values intact
// (AC-ONB-3). Choosing the baseline at Calibration runs it before the
// Placement step (P8); placement then reads the latest Assessment.
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { Select } from '../../components/base/Select';
import { Stepper } from '../../components/base/Stepper';
import { TextField } from '../../components/base/TextField';
import { InputString } from '../../components/signature/InputString';
import { FLAGS } from '../../config/flags';
import { CONTROLLER_GLYPH, CONTROLLERS, DAY_NAMES, PLATFORM_GLYPH, RANKS, SESSION_MINUTES_OPTIONS } from '../../config/ranks';
import { buildTodayPlan } from '../../app/plan';
import { buildRealPlanState, todayIso } from '../../app/planState';
import { loadCurriculum } from '../../data/packs';
import { assessmentsRepo } from '../../data/repos';
import type { Assessment, Profile } from '../../data/schemas';
import type { Plan } from '../../domain/engine/plan';
import { isOnboardingDone, useAppStore } from '../../stores/appStore';
import './OnboardingScreen.css';

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'profile', label: 'Profile' },
  { id: 'time', label: 'Time' },
  { id: 'history', label: 'History' },
  { id: 'calibration', label: 'Calibration' },
  { id: 'placement', label: 'Placement' },
];

export function OnboardingScreen() {
  const profile = useAppStore((s) => s.profile);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const navigate = useNavigate();
  const [choice, setChoice] = useState<'baseline' | 'stage0'>('stage0');
  // Display name is drafted locally: persisting every keystroke would write
  // a transiently empty name and fail profile validation (min 1). The draft
  // is written through on blur and on Continue; non-empty keystrokes also
  // write through so a reload keeps typed text (AC-ONB-3). Null draft means
  // "follow the stored profile value".
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (!profile) return <main><p>Loading…</p></main>;
  if (isOnboardingDone(profile)) {
    return <Navigate to="/today" replace />;
  }

  const step = profile.onboardingStep ?? 0;
  const nameValue = nameDraft ?? profile.displayName;
  const goTo = (next: number) => void saveProfile({ onboardingStep: next });
  const patch = (p: Partial<Profile>) => void saveProfile(p);

  const finish = () => {
    // §14.3: request persistent storage at the end of onboarding, so the
    // browser is less likely to clear site storage. Best-effort: a denial
    // changes nothing, and Diagnostics reports the granted state.
    if (typeof navigator !== 'undefined' && navigator.storage?.persist !== undefined) {
      void navigator.storage.persist().catch(() => undefined);
    }
    void saveProfile({ onboardingStep: 6 }).then(() => navigate('/today', { replace: true }));
  };

  return (
    <div className="z-onboarding">
      <Stepper steps={STEPS} currentIndex={step} ariaLabel="Onboarding progress" onStepClick={(i) => { if (i < step) goTo(i); }} />
      {step === 0 && (
        <Card title="Welcome to ZANSHIN">
          <p className="z-body-l">A calm, candid coach for your Yoshimitsu — from first controls to Tekken King.</p>
          <p className="z-body-l">Your data stays on this device. No account, no cloud, no uploads.</p>
          <p className="z-body-l">残心 — lingering mind: finish the move, then stay ready for the next one.</p>
          <Button onClick={() => goTo(1)}>Get started</Button>
        </Card>
      )}
      {step === 1 && (
        <Card title="Your profile">
          <TextField id="ob-name" label="Display name" value={nameValue}
            onChange={(v) => {
              setNameDraft(v);
              if (v.trim() !== '') patch({ displayName: v });
            }}
            onBlur={() => {
              if (nameValue.trim() !== '') patch({ displayName: nameValue });
              else setNameDraft(profile.displayName);
            }}
            error={nameValue.trim() === '' ? 'Display name is required.' : undefined} />
          <Select id="ob-platform" label="Platform" value={profile.platform}
            options={[
              { value: 'ps5', label: 'PlayStation 5' },
              { value: 'pc', label: 'PC (Steam)' },
              { value: 'xbox', label: 'Xbox' },
            ]}
            onChange={(v) => {
              const platform = v as Profile['platform'];
              patch({ platform, glyphMode: PLATFORM_GLYPH[platform] });
            }} />
          <Select id="ob-controller" label="Controller" value={profile.controller}
            options={CONTROLLERS.map((c) => ({ value: c, label: c }))}
            onChange={(v) => {
              const glyphMode = CONTROLLER_GLYPH[v as (typeof CONTROLLERS)[number]];
              patch(glyphMode === undefined ? { controller: v } : { controller: v, glyphMode });
            }} />
          <Select id="ob-glyph" label="Button glyphs" value={profile.glyphMode}
            options={[
              { value: 'playstation', label: 'PlayStation (△ ○ × □)' },
              { value: 'xbox', label: 'Xbox (Y B A X)' },
              { value: 'numeric', label: 'Numeric (1 2 3 4)' },
            ]}
            onChange={(v) => patch({ glyphMode: v as Profile['glyphMode'] })} />
          <p className="z-label">Glyph preview</p>
          <InputString input="b+2,1,1+2" glyphMode={profile.glyphMode} />
          <TextField id="ob-tekken-id" label="Tekken ID (optional)" value={profile.tekkenId ?? ''}
            onChange={(v) => patch({ tekkenId: v === '' ? undefined : v })} />
          <Select id="ob-current-rank" label="Current rank (optional)" value={profile.currentRank ?? ''}
            options={[{ value: '', label: 'No rank yet' }, ...RANKS.map((r) => ({ value: r, label: r }))]}
            onChange={(v) => patch({ currentRank: v === '' ? undefined : v })} />
          <Select id="ob-target-rank" label="Target rank" value={profile.targetRank}
            options={RANKS.map((r) => ({ value: r, label: r }))}
            onChange={(v) => patch({ targetRank: v })} />
          <TextField id="ob-target-date" label="Target date (optional)" type="date" value={profile.targetDate ?? ''}
            onChange={(v) => patch({ targetDate: v === '' ? undefined : v })} />
          <div className="z-onboarding__actions">
            <Button variant="secondary" onClick={() => goTo(0)}>Back</Button>
            <Button onClick={() => {
              if (nameValue.trim() !== '') patch({ displayName: nameValue });
              goTo(2);
            }} disabled={nameValue.trim() === ''}>Continue</Button>
          </div>
        </Card>
      )}
      {step === 2 && (
        <Card title="Your time">
          <Select id="ob-session" label="Session length" value={String(profile.sessionMinutes)}
            options={SESSION_MINUTES_OPTIONS.map((m) => ({ value: String(m), label: `${m} minutes` }))}
            onChange={(v) => patch({ sessionMinutes: Number(v) })} />
          <TextField id="ob-weekly" label="Weekly hours" type="number" inputMode="numeric" value={String(profile.weeklyMinutes / 60)}
            onChange={(v) => {
              const hours = Number(v);
              if (Number.isFinite(hours) && hours >= 0) patch({ weeklyMinutes: Math.round(hours * 60) });
            }}
            hint="How many hours per week you can practise." />
          <fieldset className="z-onboarding__days">
            <legend className="z-label">Preferred days (optional — leave empty for every day)</legend>
            {DAY_NAMES.map((day, i) => (
              <label key={day} className="z-onboarding__day">
                <input type="checkbox" checked={profile.preferredDays.includes(i)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...profile.preferredDays, i]
                      : profile.preferredDays.filter((d) => d !== i);
                    patch({ preferredDays: next });
                  }} />
                {day}
              </label>
            ))}
          </fieldset>
          <TextField id="ob-boundary" label="Day boundary" type="time" value={profile.dayBoundary}
            onChange={(v) => patch({ dayBoundary: v })}
            hint="Sessions after this time count toward the next practice day. Default 04:00." />
          <div className="z-onboarding__actions">
            <Button variant="secondary" onClick={() => goTo(1)}>Back</Button>
            <Button onClick={() => goTo(3)}>Continue</Button>
          </div>
        </Card>
      )}
      {step === 3 && (
        <Card title="Your history">
          <p className="z-body-l">You told us you played Yoshimitsu hard in Tekken 7, about twelve years ago, and you are starting Tekken 8 as a beginner again. These answers set that up — change them if they are wrong.</p>
          <Select id="ob-t7" label="Played Yoshimitsu in Tekken 7?" value={profile.playedTekken7 === false ? 'no' : 'yes'}
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
            onChange={(v) => patch({ playedTekken7: v === 'yes' })} />
          <TextField id="ob-t8-hours" label="Tekken 8 hours so far" type="number" inputMode="numeric"
            value={String(profile.tekken8Hours ?? 0)}
            onChange={(v) => {
              const hours = Number(v);
              if (Number.isFinite(hours) && hours >= 0) patch({ tekken8Hours: hours });
            }} />
          <div className="z-onboarding__actions">
            <Button variant="secondary" onClick={() => goTo(2)}>Back</Button>
            <Button onClick={() => goTo(4)}>Continue</Button>
          </div>
        </Card>
      )}
      {step === 4 && (
        <Card title="Calibration">
          <p className="z-body-l">Placement uses measured data, not memory. Run the baseline for a precise start, or begin at Stage 0 and calibrate as you go.</p>
          <div className="z-onboarding__choices" role="radiogroup" aria-label="Calibration choice">
            <label className="z-onboarding__choice">
              <input type="radio" name="calibration" value="baseline" checked={choice === 'baseline'}
                disabled={!FLAGS.baseline}
                onChange={() => setChoice('baseline')} />
              <span><strong>Run the baseline</strong> — about 45 minutes, recommended for returning players.
                {!FLAGS.baseline && ' The baseline runner arrives in a later phase — for now, start at Stage 0.'}</span>
            </label>
            <label className="z-onboarding__choice">
              <input type="radio" name="calibration" value="stage0" checked={choice === 'stage0'}
                onChange={() => setChoice('stage0')} />
              <span><strong>Start at Stage 0</strong> — calibrate along the way. You can run the baseline later.</span>
            </label>
          </div>
          <div className="z-onboarding__actions">
            <Button variant="secondary" onClick={() => goTo(3)}>Back</Button>
            <Button
              onClick={() => {
                if (choice === 'baseline' && FLAGS.baseline) {
                  // Baseline runs before placement: stay on step 5 and
                  // hand over to /baseline, which returns here after
                  // computing placement.
                  void saveProfile({ onboardingStep: 5 }).then(() => navigate('/baseline'));
                } else {
                  goTo(5);
                }
              }}
              disabled={choice === 'baseline' && !FLAGS.baseline}>Continue</Button>
          </div>
        </Card>
      )}
      {step === 5 && <PlacementStep profile={profile} onBack={() => goTo(4)} onFinish={finish} />}
    </div>
  );
}

function PlacementStep({ profile, onBack, onFinish }: { profile: Profile; onBack: () => void; onFinish: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [realPlan, setRealPlan] = useState<Plan | null>(null);

  // The latest Assessment (written by runPlacement) decides the starting
  // stage. With settings available, the preview is the real first plan;
  // otherwise it falls back to the fresh-mastery preview (skipped
  // baseline case keeps the exact Stage 0 text below).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = await assessmentsRepo.all();
      // Placement rows carry the runPlacement id shape; per-quiz
      // evidence rows (assessment-quiz-*) are not placement results.
      const placementRows = all.filter((row) => !row.id.startsWith('assessment-quiz-'));
      const latest = placementRows[placementRows.length - 1] ?? null;
      if (cancelled) return;
      setAssessment(latest);
      if (latest !== null && settings !== null) {
        try {
          const { plan } = await buildRealPlanState(profile, settings, todayIso());
          if (!cancelled) setRealPlan(plan);
        } catch {
          // Keep the fresh-mastery preview on any plan failure.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [profile, settings]);

  const fallbackPlan = buildTodayPlan(profile, 0);
  const plan = realPlan ?? fallbackPlan;

  if (assessment === null) {
    return (
      <Card title="Your placement">
        <p className="z-body-l">Starting stage: <strong>Stage 0 — Calibration</strong>. No stages tested out — the baseline was skipped, so placement never skips a stage.</p>
        <p className="z-body-l">Your first plan ({plan.total} minutes):</p>
        <ul className="z-onboarding__plan">
          {plan.blocks.map((block, i) => (
            <li key={`${block.kind}-${i}`}>{block.minutes} min — {block.reason}</li>
          ))}
        </ul>
        <div className="z-onboarding__actions">
          <Button variant="secondary" onClick={onBack}>Back</Button>
          <Button onClick={onFinish}>Start today&apos;s plan</Button>
        </div>
      </Card>
    );
  }

  const curriculum = loadCurriculum();
  const stage = curriculum.stages.find((s) => s.index === assessment.placementStage);
  const stageTitle = stage?.title ?? 'Calibration';
  const testedOut = assessment.placementStage === 0
    ? 'No stages tested out.'
    : `Stages tested out: ${Array.from({ length: assessment.placementStage }, (_, i) => `Stage ${i}`).join(', ')}.`;
  return (
    <Card title="Your placement">
      <p className="z-body-l">Starting stage: <strong>Stage {assessment.placementStage} — {stageTitle}</strong>. {testedOut}</p>
      <p className="z-body-l">Your first plan ({plan.total} minutes):</p>
      <ul className="z-onboarding__plan">
        {plan.blocks.map((block, i) => (
          <li key={`${block.kind}-${i}`}>{block.minutes} min — {block.reason}</li>
        ))}
      </ul>
      <div className="z-onboarding__actions">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button onClick={onFinish}>Start today&apos;s plan</Button>
      </div>
    </Card>
  );
}
