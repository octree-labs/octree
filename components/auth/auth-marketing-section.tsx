'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import LogoCloud from '@/components/ui/logo-cloud';
import { Play, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from '@/components/ui/dialog';
import {
  VideoPlayer,
  VideoPlayerContent,
  VideoPlayerControlBar,
  VideoPlayerMuteButton,
  VideoPlayerPlayButton,
  VideoPlayerTimeDisplay,
  VideoPlayerTimeRange,
} from '@/components/ui/video-player';

function UseCaseCarousel({ useCases }: { useCases: { title: string; description: string; videoUrl: string }[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showFront, setShowFront] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const frontRef = useRef<HTMLVideoElement>(null);
  const backRef = useRef<HTMLVideoElement>(null);
  const dialogVideoRef = useRef<HTMLVideoElement>(null);
  const lockRef = useRef(false);

  // On mount, set the front video source
  useEffect(() => {
    const front = frontRef.current;
    if (front) {
      front.src = useCases[0].videoUrl;
      front.load();
      front.play().catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeVideo = useCallback((newIndex: number) => {
    if (lockRef.current) return;
    lockRef.current = true;

    // Load new video on the hidden (back) element
    const back = showFront ? backRef.current : frontRef.current;
    if (back) {
      back.src = useCases[newIndex].videoUrl;
      back.load();
      back.play().catch(() => {});
    }

    // Crossfade: hide front, show back
    setShowFront((prev) => !prev);
    setCurrentIndex(newIndex);

    // After transition, pause old video and unlock
    setTimeout(() => {
      const old = showFront ? frontRef.current : backRef.current;
      if (old) old.pause();
      lockRef.current = false;
    }, 400);
  }, [showFront, useCases]);

  const goToNext = useCallback(() => {
    changeVideo((currentIndex + 1) % useCases.length);
  }, [currentIndex, useCases.length, changeVideo]);

  const goToPrev = useCallback(() => {
    changeVideo((currentIndex - 1 + useCases.length) % useCases.length);
  }, [currentIndex, useCases.length, changeVideo]);

  // Pause inline video when dialog opens, play dialog video
  const handleDialogChange = useCallback((open: boolean) => {
    setDialogOpen(open);
    const active = showFront ? frontRef.current : backRef.current;
    if (open) {
      active?.pause();
      setTimeout(() => {
        const dialogVideo = dialogVideoRef.current;
        if (dialogVideo && active) {
          dialogVideo.currentTime = active.currentTime ?? 0;
          dialogVideo.play().catch(() => {});
        }
      }, 50);
    } else {
      active?.play().catch(() => {});
    }
  }, [showFront]);

  const current = useCases[currentIndex];

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Video with arrows on left and right */}
      <div className="relative w-full">
        <button
          onClick={goToPrev}
          className="absolute -left-8 top-1/2 -translate-y-1/2 z-10 p-1 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Previous use case"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
          <DialogTrigger asChild>
            <div className="relative overflow-hidden shadow-md bg-black aspect-video w-full cursor-pointer group">
              {/* Front video */}
              <video
                ref={frontRef}
                muted
                playsInline
                onEnded={goToNext}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                  showFront ? 'opacity-100 z-[1]' : 'opacity-0 z-0'
                }`}
              />
              {/* Back video */}
              <video
                ref={backRef}
                muted
                playsInline
                onEnded={goToNext}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                  showFront ? 'opacity-0 z-0' : 'opacity-100 z-[1]'
                }`}
              />
              {/* Play overlay on hover */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
                  <Play className="h-5 w-5 fill-current text-black ml-0.5" />
                </div>
              </div>
            </div>
          </DialogTrigger>
        <DialogContent className="sm:max-w-5xl w-[95vw] p-0 overflow-visible border-none bg-transparent shadow-none" showCloseButton={false}>
          <DialogTitle className="sr-only">{current.title}</DialogTitle>
          <div className="relative group/modal">
            <VideoPlayer className="w-full overflow-hidden rounded-xl shadow-2xl bg-black aspect-video">
              <VideoPlayerContent
                ref={dialogVideoRef}
                src={current.videoUrl}
                playsInline
                preload="auto"
                autoPlay
                muted
                loop
                slot="media"
                className="w-full h-full"
                style={{
                  objectFit: 'contain',
                  objectPosition: '50% 50%',
                  transform: 'translateZ(0)',
                  imageRendering: 'auto',
                }}
              />
              <VideoPlayerControlBar>
                <VideoPlayerPlayButton />
                <VideoPlayerTimeRange />
                <VideoPlayerTimeDisplay showDuration />
                <VideoPlayerMuteButton />
              </VideoPlayerControlBar>
            </VideoPlayer>

            <DialogClose className="absolute -top-12 right-0 rounded-full bg-white/10 p-2 ring-offset-background transition-opacity hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X className="h-5 w-5 text-white" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>

        <button
          onClick={goToNext}
          className="absolute -right-8 top-1/2 -translate-y-1/2 z-10 p-1 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Next use case"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Title and description below */}
      <div className="text-center px-2">
        <h3 className="text-lg font-semibold text-foreground">
          {current.title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {current.description}
        </p>
      </div>
    </div>
  );
}

const useCases = [
  {
    title: 'Generate Research Papers',
    description: 'Citations and equations, formatted for you.',
    videoUrl: '/assets/videos/research.mp4',
  },
  {
    title: 'Create Technical Presentations',
    description: 'Beamer slides for talks and lectures in minutes.',
    videoUrl: '/assets/videos/beamer.mp4',
  },
  {
    title: 'AI-Powered Editing Agent',
    description: 'Change your whole project with one prompt.',
    videoUrl: '/assets/videos/edit.mp4',
  },
  {
    title: 'Fix Errors with AI',
    description: 'One-click fixes for LaTeX compile errors.',
    videoUrl: '/assets/videos/fix-errors.mp4',
  },
  {
    title: 'Create Professional Resumes',
    description: 'Polished, ATS-friendly resumes in LaTeX.',
    videoUrl: '/assets/videos/resume.mp4',
  },
];

export function AuthMarketingSection() {
  return (
    <div className="relative hidden w-1/2 bg-muted lg:flex lg:flex-col lg:items-center lg:p-12 overflow-hidden h-screen">
      <div
        className="animate-pulse-slow absolute inset-0"
        style={{
          backgroundImage: 'url(/assets/dotted-background.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      {/* Carousel and logos as one block, centred vertically. */}
      <div className="relative z-10 mx-auto flex h-full w-full max-w-2xl flex-col justify-center gap-12 pb-12 pt-28">
        <UseCaseCarousel useCases={useCases} />

        <div className="shrink-0">
          <p className="mb-1.5 text-center text-muted-foreground text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">
            Used by researchers at
          </p>
          <LogoCloud />
        </div>
      </div>
    </div>
  );
}
