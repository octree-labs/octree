import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import LogoCloud from '@/components/ui/logo-cloud';

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
        <blockquote className="text-center">
          <p className="mb-8 text-2xl font-medium leading-tight md:text-3xl">
            "Write LaTeX like never before... I'm in love."
          </p>

          <div className="flex items-center justify-center gap-4">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                SC
              </AvatarFallback>
            </Avatar>

            <div className="space-y-1 border-l pl-4 text-left">
              <cite className="font-semibold not-italic">Dr. Sarah Chen</cite>
              <span className="block text-sm text-muted-foreground">
                Research Scientist • MIT
              </span>
            </div>
          </div>
        </blockquote>
      </div>

      <div className="relative z-10 pb-16">
        <p className="mb-2 text-center text-sm text-muted-foreground">
          Trusted by researchers at
        </p>
        <LogoCloud />
      </div>
    </div>
  );
}

