import { BrandMark } from '../components/BrandMark'
import { Enquiry } from '../components/Enquiry'
import { Farm } from '../components/Farm'
import { FarmMap } from '../components/FarmMap'
import { Hero } from '../components/Hero'
import { Process } from '../components/Process'
import { StemStudy } from '../components/StemStudy'
import { VarietyBand } from '../components/VarietyBand'
import { Varieties } from '../components/Varieties'
import { site } from '../content/site'

/**
 * One page, read top to bottom: what this is, the variety the farm is known
 * for (pinned, in 3D), what we grow, how an order gets filled, who we are, and
 * then the ask, and where to find the farm. Every photograph below the hero is a same-size PhotoCard.
 */
export default function HomePage() {
  return (
    <>
      <Hero brand={<BrandMark className="rw-hero__mark" label={site.name} />} />
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
