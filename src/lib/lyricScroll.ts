// Exact critically damped step, stable at different refresh rates.
export function stepLyricScroll(position: number, velocity: number, target: number, seconds: number) {
  const dt = Math.min(0.05, Math.max(0, seconds));
  const frequency = 12;
  const offset = position - target;
  const impulse = velocity + frequency * offset;
  const decay = Math.exp(-frequency * dt);
  return {
    position: target + (offset + impulse * dt) * decay,
    velocity: (velocity - frequency * impulse * dt) * decay,
  };
}
