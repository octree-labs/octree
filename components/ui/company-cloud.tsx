import { InfiniteSlider } from '@/components/ui/infinite-slider';

export default function CompanyCloud() {
  return (
    <section className="overflow-hidden bg-transparent py-0">
      <div className="group relative m-auto max-w-7xl">
        <div className="relative w-full py-6">
          <InfiniteSlider speedOnHover={5} speed={20} gap={80} reverse>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/harvard.png"
                alt="Harvard University"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/nyu.png"
                alt="Company logo"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-14 w-auto object-contain dark:invert"
                src="/logos/rwth.svg"
                alt="Company logo"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/iitm.png"
                alt="Company logo"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-14 w-auto object-contain dark:invert"
                src="/logos/johns-hopkins.png"
                alt="Company logo"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/imu.png"
                alt="Company logo"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/south-dakota.svg"
                alt="Company logo"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/muni.png"
                alt="Company logo"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/uaq.svg"
                alt="Company logo"
              />
            </div>
          </InfiniteSlider>
        </div>
      </div>
    </section>
  );
}

