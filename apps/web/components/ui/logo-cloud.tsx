import { InfiniteSlider } from '@/components/ui/infinite-slider';

export default function LogoCloud() {
  return (
    <section className="overflow-hidden bg-transparent py-0">
      <div className="group relative m-auto max-w-7xl">
        <div className="relative w-full py-6">
          <InfiniteSlider speedOnHover={5} speed={20} gap={80}>
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
                alt="New York University"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-14 w-auto object-contain dark:invert"
                src="/logos/rwth.svg"
                alt="RWTH Aachen University"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/iitm.png"
                alt="Indian Institute of Technology Madras"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-14 w-auto object-contain dark:invert"
                src="/logos/johns-hopkins.png"
                alt="Johns Hopkins University"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/imu.png"
                alt="Inner Mongolia University"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/south-dakota.svg"
                alt="South Dakota State University"
              />
            </div>

            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/muni.png"
                alt="Masaryk University"
              />
            </div>
            <div className="flex items-center justify-center">
              <img
                className="h-12 w-auto object-contain dark:invert"
                src="/logos/uaq.svg"
                alt="Universidad Autónoma de Querétaro"
              />
            </div>
          </InfiniteSlider>
        </div>
      </div>
    </section>
  );
}
