import { usePenDrawing } from '@/lib/pen-drawing';

/** Small pen drawings, kept as vectors so the menu stays light. */
export function MenuDoodle({ active = true }: { active?: boolean }) {
  const phase = usePenDrawing(active);
  return (
    <svg
      className="menu-doodle pen-drawing"
      data-draw={phase}
      viewBox="0 0 220 200"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse
          pathLength="1"
          className="doodle-shadow"
          cx="111"
          cy="167"
          rx="75"
          ry="12"
          strokeWidth="1"
        />
        <path
          pathLength="1"
          className="doodle-bowl-fill"
          d="M43 102c7 38 27 61 65 63 37 2 61-21 71-62"
        />
        <path
          pathLength="1"
          d="M43 103c15 14 111 17 136-1M47 107c17 37 37 49 64 51"
          opacity=".35"
        />
        <ellipse pathLength="1" cx="111" cy="102" rx="68" ry="19" transform="rotate(-3 111 102)" />
        <path
          pathLength="1"
          d="M64 99c6-13 18-11 24-2s15 10 22-1 17-12 24-1 16 12 27 2M68 107c7-8 15-7 22-1s15 8 23-1 17-8 25 0"
        />
        <path pathLength="1" d="m134 93 58-70m-47 70 55-65" strokeWidth="3" />
        <path pathLength="1" className="doodle-steam steam-a" d="M83 72c-12-11 8-16 0-29" />
        <path pathLength="1" className="doodle-steam steam-b" d="M110 65c-13-11 8-16 0-29" />
        <path pathLength="1" className="doodle-steam steam-c" d="M133 72c-10-9 7-15 0-23" />
        <path
          pathLength="1"
          d="m28 61 4 10 10 3-10 3-4 10-3-11-10-3 10-2Zm147 84 3 5 6 1-5 3-1 6-3-5-6-1 5-3Z"
          strokeWidth="1.5"
        />
        <path pathLength="1" d="M58 178c31 8 81 8 104-2" opacity=".4" />
      </g>
    </svg>
  );
}
