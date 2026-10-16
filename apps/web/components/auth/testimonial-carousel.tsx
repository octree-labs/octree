'use client';

import { useState, useEffect } from 'react';

interface Testimonial {
  quote: string;
  author: string;
  role: string;
}

interface TestimonialCarouselProps {
  testimonials: Testimonial[];
}

export function TestimonialCarousel({ testimonials }: TestimonialCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % testimonials.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [testimonials.length]);

  const current = testimonials[currentIndex];

  return (
    <blockquote className="text-center transition-opacity duration-500">
      <p className="mb-8 text-2xl font-medium leading-tight md:text-3xl">
        "{current.quote}"
      </p>

      <div className="flex items-center justify-center gap-4">
        <div className="space-y-1 text-left">
          <cite className="font-semibold not-italic">{current.author}</cite>
          <span className="block text-sm text-muted-foreground">
            {current.role}
          </span>
        </div>
      </div>

      <div className="mt-6 flex justify-center gap-2">
        {testimonials.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`h-2 w-2 rounded-full transition-colors ${
              index === currentIndex ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
            aria-label={`Go to testimonial ${index + 1}`}
          />
        ))}
      </div>
    </blockquote>
  );
}

