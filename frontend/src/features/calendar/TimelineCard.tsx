import { useRef, useState, type ButtonHTMLAttributes } from 'react';
import type { Booking } from '@/features/bookings/contracts';
import { proposeChange, type CalendarProposal } from './CalendarChange';

export function TimelineCard({
  booking,
  elapsed,
  step,
  onPropose,
  children,
  style,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  booking: Booking;
  elapsed: number;
  step: number;
  onPropose?: (proposal: CalendarProposal) => void;
}) {
  const gesture = useRef<{
    x: number;
    width: number;
    resize: boolean;
    pointer: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const [delta, setDelta] = useState(0);
  const editable = booking.status === 'confirmed' && Boolean(onPropose);
  const propose = (minutes: number, resize: boolean) => {
    const next = proposeChange(booking, minutes, resize);
    if (minutes && next.duration > 0 && next.duration <= 1440)
      onPropose?.(next);
  };
  return (
    <button
      {...props}
      type="button"
      style={{
        ...style,
        touchAction: editable ? 'pan-y' : undefined,
        transform:
          delta && !gesture.current?.resize
            ? `translateX(${delta}px)`
            : undefined,
        width:
          delta && gesture.current?.resize
            ? `max(5px, calc(${style?.width ?? '0px'} + ${delta}px))`
            : style?.width,
      }}
      aria-describedby={editable ? 'timeline-edit-help' : undefined}
      onKeyDown={(event) => {
        if (!editable || !['ArrowLeft', 'ArrowRight'].includes(event.key))
          return;
        event.preventDefault();
        propose(
          (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? step : 15),
          event.shiftKey,
        );
      }}
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (!editable || !event.isPrimary || event.button !== 0) return;
        const width =
          event.currentTarget.parentElement!.getBoundingClientRect().width;
        if (!width) return;
        gesture.current = {
          x: event.clientX,
          width,
          resize:
            (event.target as HTMLElement).closest('[data-resize]') !== null,
          pointer: event.pointerId,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (gesture.current?.pointer === event.pointerId)
          setDelta(event.clientX - gesture.current.x);
      }}
      onPointerCancel={() => {
        gesture.current = null;
        setDelta(0);
      }}
      onLostPointerCapture={() => {
        gesture.current = null;
        setDelta(0);
      }}
      onPointerUp={(event) => {
        const current = gesture.current;
        gesture.current = null;
        setDelta(0);
        if (!current || current.pointer !== event.pointerId) return;
        const pixels = event.clientX - current.x;
        if (Math.abs(pixels) < 5) return;
        suppressClick.current = true;
        const snap = current.resize ? step : 15;
        propose(
          Math.round(((pixels / current.width) * elapsed) / 60000 / snap) *
            snap,
          current.resize,
        );
      }}
      onClick={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
      {editable && (
        <span
          className="timeline-resize"
          data-resize
          title="Drag to change duration"
          aria-hidden="true"
        >
          ↔
        </span>
      )}
    </button>
  );
}
