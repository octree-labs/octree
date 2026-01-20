'use client';

import LogoCloud from '@/components/ui/logo-cloud';
import { TestimonialCarousel } from './testimonial-carousel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Play, X, ArrowRight } from 'lucide-react';
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

const testimonials = [
  {
    quote:
      'Octree removes much of the tedium of resume formatting and journal typesetting, allowing me to spend that saved time focusing on the actual content and not just the presentation.',
    author: 'Jason Nguyen',
    role: 'Software Engineer at DoorDash',
  },
  {
    quote:
      "The AI helps a lot when there's an error... I'm enjoying studying with it.",
    author: 'Emerson Alves',
    role: 'Research Student',
  },
];

const useCases = [
  {
    title: 'Generate Research Papers',
    description:
      'Transform your ideas into professionally formatted academic papers with citations and equations handled automatically.',
    videoUrl: '/assets/videos/research.mp4',
  },
  {
    title: 'Create Technical Presentations',
    description:
      'Build stunning Beamer presentations with AI assistance. Polish your slides for conferences and lectures in minutes.',
    videoUrl: '/assets/videos/beamer.mp4',
  },
  {
    title: 'AI-Powered Editing Agent',
    description:
      'Edit your documents like you would with Cursor — but built for academics. Refactor your entire project with a simple command.',
    videoUrl: '/assets/videos/edit.mp4',
  },
  {
    title: 'Fix Errors with AI',
    description:
      'One-click fixes for complex LaTeX compilation errors. Stop debugging and start writing with our intelligent error detection.',
    videoUrl: '/assets/videos/fix-errors.mp4',
  },
  {
    title: 'Create Professional Resumes',
    description:
      'Generate polished, ATS-friendly resumes using industry-standard LaTeX templates and AI-optimized content.',
    videoUrl: '/assets/videos/resume.mp4',
  },
];

export function AuthMarketingSection() {
  return (
    <div className="relative hidden w-1/2 bg-muted lg:flex lg:flex-col lg:p-12 overflow-hidden h-screen">
      <div
        className="animate-pulse-slow absolute inset-0"
        style={{
          backgroundImage: 'url(/assets/dotted-background.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      <div className="relative z-10 flex flex-col h-full w-full max-w-md mx-auto justify-between py-12">
        <Tabs defaultValue="use-cases" className="flex flex-col w-full">
          {/* Tabs header - fixed at top */}
          <TabsList className="grid w-full grid-cols-2 shrink-0">
            <TabsTrigger value="testimonials">Testimonials</TabsTrigger>
            <TabsTrigger value="use-cases">Use Cases</TabsTrigger>
          </TabsList>

          {/* Content area - Fixed height to prevent any layout shift */}
          <div className="h-[450px] mt-8 flex flex-col">
            <TabsContent 
              value="testimonials" 
              className="m-0 flex-1 data-[state=active]:flex flex-col items-center justify-center animate-in fade-in duration-300"
            >
              <TestimonialCarousel testimonials={testimonials} />
            </TabsContent>

            <TabsContent 
              value="use-cases" 
              className="m-0 flex-1 data-[state=active]:flex flex-col justify-center animate-in fade-in duration-300"
            >
              <div className="space-y-3 w-full">
                {useCases.map((useCase, index) => (
                  <Dialog key={index}>
                    <DialogTrigger asChild>
                      <div
                        className="group relative rounded-xl bg-gradient-to-t from-background to-background/80 backdrop-blur-sm p-3.5 transition-all hover:brightness-110 active:brightness-95 border border-zinc-950/25 shadow-md shadow-zinc-950/20 ring-1 ring-inset ring-white/20 cursor-pointer hover:-translate-y-0.5 hover:border-primary/30"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-t from-primary to-primary/85 text-primary-foreground border border-zinc-950/25 shadow-sm shadow-zinc-950/20 ring-1 ring-inset ring-white/20 transition-all group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                            <Play className="h-3 w-3 fill-current" />
                          </div>
                          <div className="flex-1 min-w-0 pr-12">
                            <div className="flex items-center justify-between">
                              <h3 className="font-semibold text-foreground text-sm mb-0.5 leading-none">
                                {useCase.title}
                              </h3>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                              {useCase.description}
                            </p>
                          </div>
                        </div>
                        
                        {/* Hidden indicator arrow that appears on hover */}
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 translate-x-2 transition-all duration-300">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm shadow-zinc-950/20 ring-1 ring-inset ring-white/20">
                            <ArrowRight className="size-3.5" />
                          </div>
                        </div>
                      </div>
                    </DialogTrigger>
                      <DialogContent className="sm:max-w-5xl w-[95vw] p-0 overflow-visible border-none bg-transparent shadow-none" showCloseButton={false}>
                        <DialogTitle className="sr-only">{useCase.title}</DialogTitle>
                        <div className="relative group/modal">
                          <VideoPlayer className="w-full overflow-hidden rounded-xl shadow-2xl bg-black aspect-video">
                            <VideoPlayerContent
                              key={`video-${index}`}
                              src={useCase.videoUrl}
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
                                transform: 'translateZ(0)', // Force GPU acceleration
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
                        
                        {/* Exact close button from marketing site */}
                        <DialogClose className="absolute -top-12 right-0 rounded-full bg-white/10 p-2 ring-offset-background transition-opacity hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                          <X className="h-5 w-5 text-white" />
                          <span className="sr-only">Close</span>
                        </DialogClose>
                      </div>
                    </DialogContent>
                  </Dialog>
                ))}
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {/* Logo cloud - pinned to bottom */}
        <div className="shrink-0 mt-4">
          <p className="mb-4 text-center text-muted-foreground text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">
            Used by researchers at
          </p>
          <LogoCloud />
        </div>
      </div>
    </div>
  );
}
