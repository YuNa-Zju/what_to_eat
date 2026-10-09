import { useEffect, useState } from 'react';

/** Draw only on the first appearance; tab changes keep the finished illustration. */
export function usePenDrawing(active: boolean) {
  const [phase, setPhase] = useState<'pending' | 'drawing' | 'done'>('pending');
  useEffect(() => {
    if (active && phase === 'pending')
      setPhase(matchMedia('(prefers-reduced-motion: reduce)').matches ? 'done' : 'drawing');
  }, [active, phase]);
  useEffect(() => {
    if (phase !== 'drawing') return;
    const timer = setTimeout(() => setPhase('done'), 2100);
    return () => clearTimeout(timer);
  }, [phase]);
  return phase;
}
