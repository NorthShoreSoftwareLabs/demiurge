import { Image, page } from "@demiurgejs/core";
import { images } from "../images";

export const GET = page({ view: HeroPage });

function HeroPage() {
  return (
    <main>
      <h1>Optimized images</h1>
      <p>
        The server transforms each variant on request and answers a repeat
        request from its encoded cache.
      </p>
      <Image
        alt="A layered mountain skyline at dusk"
        height={300}
        policy={images}
        priority
        quality={72}
        sizes="(min-width: 720px) 600px, 100vw"
        src="/hero.png"
        width={600}
        widths={[600, 1200]}
      />
    </main>
  );
}
