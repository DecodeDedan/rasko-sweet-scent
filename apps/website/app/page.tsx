import { BrandMark } from '../components/BrandMark'
import { Enquiry } from '../components/Enquiry'
import { Farm } from '../components/Farm'
import { FarmMap } from '../components/FarmMap'
import { Hero } from '../components/Hero'
import { Process } from '../components/Process'
import { StemStudy } from '../components/StemStudy'
import { VarietyBand } from '../components/VarietyBand'
import { Varieties } from '../components/Varieties'
import logo from '../../../docs/brand/logo.svg'
import { photos } from '../content/photos'
import { site } from '../content/site'
import { homeJsonLd, serialiseJsonLd } from '../lib/structuredData'

/**
 * One page, read top to bottom: what this is, the variety the farm is known
 * for (pinned, in 3D), what we grow, how an order gets filled, who we are, and
 * then the ask, and where to find the farm. Every photograph below the hero is a same-size PhotoCard.
 */
export default function HomePage() {
  const heroPhoto = photos[site.hero.photo]
  const heroImage = `/photos/${site.hero.photo}-${heroPhoto.widths[heroPhoto.widths.length - 1]}.webp`

  return (
    <>
      <script
        type="application/ld+json"
        // Serialised from our own content, with `<` escaped: safe to inline.
        dangerouslySetInnerHTML={{ __html: serialiseJsonLd(homeJsonLd(logo.src, heroImage)) }}
      />
      <Hero brand={<BrandMark className="rw-hero__mark" />} />
      <StemStudy />
      <Varieties />
      <VarietyBand />
      <Process />
      <Farm />
      <Enquiry />
      <FarmMap />
    </>
  )
}
