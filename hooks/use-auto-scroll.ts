import { useEffect, useRef } from 'react';

export function useAutoScroll<T extends HTMLElement>(enabled: boolean = true) {
  const elementRef = useRef<T>(null);
  const mouseCoords = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const animationFrame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;

    const checkScroll = () => {
      const element = elementRef.current;
      if (!element || !isDragging.current) {
        animationFrame.current = undefined;
        return;
      }

      const { top, bottom } = element.getBoundingClientRect();
      const { y } = mouseCoords.current;
      
      const threshold = 100;
      const maxSpeed = 25;

      let speed = 0;

      if (y < top + threshold) {
        const intensity = Math.min(1, Math.max(0, (top + threshold - y) / threshold));
        speed = -intensity * maxSpeed;
      } else if (y > bottom - threshold) {
        const intensity = Math.min(1, Math.max(0, (y - (bottom - threshold)) / threshold));
        speed = intensity * maxSpeed;
      }

      if (speed !== 0) {
        element.scrollTop += speed;
        animationFrame.current = requestAnimationFrame(checkScroll);
      } else {
        animationFrame.current = undefined;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseCoords.current = { x: e.clientX, y: e.clientY };
      isDragging.current = (e.buttons === 1);

      if (isDragging.current && !animationFrame.current) {
        checkScroll();
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = undefined;
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { capture: true });
    window.addEventListener('mouseup', handleMouseUp, { capture: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove, { capture: true });
      window.removeEventListener('mouseup', handleMouseUp, { capture: true });
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [enabled]);

  return elementRef;
}
