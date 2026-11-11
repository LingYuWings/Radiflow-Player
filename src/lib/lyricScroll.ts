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

// Move with layout changes before easing the remaining visual distance. Expanding
// translations must not become a second moving target for the scroll spring.
export function stepAnchoredLyricScroll(position: number, velocity: number, previousTarget: number, target: number, seconds: number) {
  const compensated = position + target - previousTarget;
  const distance = target - compensated;
  const next = stepLyricScroll(compensated, velocity * distance < 0 ? 0 : velocity, target, seconds);
  if ((target - next.position) * distance <= 0) return { position: target, velocity: 0 };
  return next;
}
