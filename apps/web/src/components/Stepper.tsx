// Visual progress per evidence-flow.mmd's S2-S6 sequence.
export function Stepper({ step, total }: { step: number; total: number }) {
  return (
    <div className="stepper" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={total} aria-label={`ขั้นตอนที่ ${step} จาก ${total}`}>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <div key={n} className="step" data-active={n === step} data-done={n < step} />
      ))}
    </div>
  );
}
