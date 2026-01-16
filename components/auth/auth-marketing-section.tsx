import LogoCloud from '@/components/ui/logo-cloud';
import { TestimonialCarousel } from './testimonial-carousel';

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

export function AuthMarketingSection() {
  return (
    <div className="relative hidden w-1/2 bg-muted lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div
        className="animate-pulse-slow absolute inset-0"
        style={{
          backgroundImage: 'url(/assets/dotted-background.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      <div className="relative z-10 flex flex-1 items-center justify-center pt-32">
        <TestimonialCarousel testimonials={testimonials} />
      </div>

      <div className="relative z-10 pb-16">
        <p className="mb-2 text-center text-muted-foreground">
          Used by researchers at
        </p>
        <LogoCloud />
      </div>
    </div>
  );
}
