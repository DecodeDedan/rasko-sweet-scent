import { Enquiry } from '../components/Enquiry'
import { Farm } from '../components/Farm'
import { Hero } from '../components/Hero'
import { Process } from '../components/Process'
import { StemStudy } from '../components/StemStudy'
import { VarietyBand } from '../components/VarietyBand'
import { Varieties } from '../components/Varieties'

/**
 * One page, read top to bottom: what this is, the variety the farm is known
 * for (pinned, in 3D), what we grow, how an order gets filled, who we are, and
 * then the ask. Every photograph below the hero is a same-size PhotoCard.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <StemStudy />
      <Varieties />
      <VarietyBand />
      <Process />
      <Farm />
      <Enquiry />
    </>
  )
}
