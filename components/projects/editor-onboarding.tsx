'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'octree_editor_onboarding_completed';
const TARGETS = ['sidebar', 'fileSidebar', 'toolbar', 'editor', 'pdf', 'chat', 'userProfile'] as const;
const TOTAL_STEPS = TARGETS.length;

const STEPS: Record<
  (typeof TARGETS)[number],
  { title: string; description: string; tips: string[] }
> = {
  sidebar: {
    title: 'Sidebar Toggle',
    description: 'Toggle the sidebar open or closed. Use the back button to return to your projects.',
    tips: ['Keyboard shortcut: ⌘K (Mac) or Ctrl+K'],
  },
  fileSidebar: {
    title: 'Folder & Files',
    description:
      'Browse your project files here. Click a file to edit it. Right-click or use the + button to add files and folders.',
    tips: [],
  },
  toolbar: {
    title: 'Toolbar',
    description:
      'Use the toolbar for bold, italic, underline. Select text in the editor and use shortcuts for quick actions.',
    tips: [
      'Compile & save: ⌘S or Ctrl+S',
      'Edit with AI: Select text, then ⌘B or Ctrl+B',
    ],
  },
  editor: {
    title: 'Code Editor',
    description:
      'Edit your LaTeX here. Click to type, select text to format or send to the AI assistant.',
    tips: [],
  },
  pdf: {
    title: 'Compile & View PDF',
    description:
      'Click Compile in the toolbar to build. Your PDF appears here. Fix errors shown, or ask the AI.',
    tips: ['Compile before exporting your PDF'],
  },
  chat: {
    title: 'AI Chat',
    description:
      'Ask the AI to fix errors, improve writing, add sections, or restructure your document.',
    tips: [
      'Fix LaTeX syntax and compile errors',
      'Improve clarity and academic tone',
      'Add sections, references, and citations',
    ],
  },
  userProfile: {
    title: 'User Profile',
    description:
      'Access your account settings, manage your subscription, or sign out.',
    tips: [],
  },
};

type Placement = 'right' | 'left' | 'bottom' | 'top';
const PLACEMENT: Record<(typeof TARGETS)[number], Placement> = {
  sidebar: 'right',
  fileSidebar: 'right',
  toolbar: 'bottom',
  editor: 'right',
  pdf: 'left',
  chat: 'left',
  userProfile: 'top',
};

const GAP = 12;
const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 220;

function getPopoverPosition(
  targetRect: DOMRect,
  placement: Placement
): { top: number; left: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;

  let top = 0;
  let left = 0;

  switch (placement) {
    case 'right':
      left = targetRect.right + GAP;
      top = targetRect.top + targetRect.height / 2 - POPOVER_HEIGHT / 2;
      break;
    case 'left':
      left = targetRect.left - POPOVER_WIDTH - GAP;
      top = targetRect.top + targetRect.height / 2 - POPOVER_HEIGHT / 2;
      break;
    case 'bottom':
      left = targetRect.left + targetRect.width / 2 - POPOVER_WIDTH / 2;
      top = targetRect.bottom + GAP;
      break;
    case 'top':
      left = targetRect.left + targetRect.width / 2 - POPOVER_WIDTH / 2;
      top = targetRect.top - POPOVER_HEIGHT - GAP;
      break;
  }

  left = Math.max(GAP, Math.min(vw - POPOVER_WIDTH - GAP, left));
  top = Math.max(GAP, Math.min(vh - POPOVER_HEIGHT - GAP, top));

  return { top, left };
}

interface EditorOnboardingProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function EditorOnboarding({ open: controlledOpen, onOpenChange }: EditorOnboardingProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;
  const [step, setStep] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const target = TARGETS[step];
  const currentStep = STEPS[target];
  const placement = PLACEMENT[target];

  const updatePosition = () => {
    const el = document.querySelector(
      `[data-onboarding-target="${target}"]`
    );
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const pos = getPopoverPosition(rect, placement);

    setTargetRect(rect);
    setPosition(pos);
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const ro = new ResizeObserver(updatePosition);
    const targetEl = document.querySelector(
      `[data-onboarding-target="${target}"]`
    );
    if (targetEl) ro.observe(targetEl);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, step, target, placement]);

  useEffect(() => {
    if (isControlled) return;
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) setInternalOpen(true);
  }, [isControlled]);

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) setStep(0);
    prevOpenRef.current = open;
  }, [open]);

  const handleComplete = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) setStep(step + 1);
    else handleComplete();
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(o);
  };

  if (!open) return null;

  if (!currentStep) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-40 bg-black/40"
        onClick={() => handleOpenChange(false)}
        aria-hidden
      />

      {targetRect && (
        <motion.div
          key={`highlight-${step}`}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{
            opacity: 1,
            scale: 1,
          }}
          transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="pointer-events-none fixed z-40 rounded-md ring-2 ring-primary ring-offset-2"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
        />
      )}

      <motion.div
        key={step}
        data-onboarding-popover
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.3,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
        className="fixed z-50 w-80 rounded-lg border bg-background p-4 shadow-lg"
        style={{ top: position.top, left: position.left }}
      >
        <h3 className="text-base font-semibold">
          {currentStep.title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {step + 1} / {TOTAL_STEPS}
          </span>
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {currentStep.description}
        </p>
        {currentStep.tips.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
            {currentStep.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleComplete}
            className="text-muted-foreground"
          >
            Skip
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBack}
              disabled={step === 0}
            >
              Back
            </Button>
            <Button size="sm" onClick={handleNext}>
              {step === TOTAL_STEPS - 1 ? 'Get started' : 'Next'}
            </Button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
