'use client';
import { initials } from './collaboration';
import type { Presence } from './collaboration';

const MAX_VISIBLE = 4;

export default function PresenceStack({ user, others }: { user: { name: string }; others: Presence[] }) {
  const visible = others.slice(0, MAX_VISIBLE);
  const overflow = others.length - visible.length;

  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        <span
          title={`${user.name} (you)`}
          className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#131622] bg-slate-600 text-[10px] font-semibold text-white"
        >
          {initials(user.name)}
        </span>
        {visible.map(person => (
          <span
            key={person.userId}
            title={person.name}
            style={{ backgroundColor: person.color }}
            className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#131622] text-[10px] font-semibold text-[#0b0e17]"
          >
            {initials(person.name)}
          </span>
        ))}
        {overflow > 0 && (
          <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#131622] bg-white/10 text-[10px] text-slate-200">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}
