'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ExternalLink, MapPin } from 'lucide-react'

import { site } from '../content/site'

/**
 * Where the farm is: a card above the footer with a Google map of Molo.
 *
 * CLICK TO LOAD, ON PURPOSE
 * A Google Maps frame contacts Google (the visitor's address, cookies) the
 * moment it renders. The privacy notice promises the site embeds nothing
 * from another company unless the visitor asks, so the frame is created only
 * after "Show map" is pressed. Until then the card is plain HTML. The
 * "Open in Google Maps" link works either way and is the fallback when the
 * frame cannot load: an iframe does not report failure, so there is no error
 * state to draw, only a way out that always works.
 */

const EMBED_ZOOM = 12

function embedUrl(query: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=${EMBED_ZOOM}&output=embed`
}

function openUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function FarmMap() {
  const { location, map } = site
  const [isShown, setIsShown] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const reduced = useReducedMotion()
  const press = reduced ? {} : { whileHover: { y: -2 }, whileTap: { y: 0, scale: 0.98 } }

  // "Show map" removes the button that had focus; hand focus to the map so a
  // keyboard user is not dropped back to the top of the page.
  useEffect(() => {
    if (isShown) frameRef.current?.focus()
  }, [isShown])

  const place = [location.area, location.county, location.country].filter(Boolean).join(', ')

  return (
    <section className="rw-container rw-section rw-map" aria-labelledby="map-heading">
      <div className="rw-card rw-map__card rw-reveal">
        <div className="rw-map__text">
          <p className="rw-map__eyebrow">
            <MapPin aria-hidden="true" size={16} strokeWidth={2} />
            {place}
          </p>
          <h2 id="map-heading" className="rw-display-2">
            {map.heading}
          </h2>
          <p className="rw-map__body">{map.body}</p>

          <div className="rw-map__actions">
            {isShown ? null : (
              <motion.button
                type="button"
                className="rw-button rw-map__show"
                onClick={() => setIsShown(true)}
                transition={{ duration: 0.2 }}
                {...press}
              >
                Show map
              </motion.button>
            )}
            <a
              className="rw-link rw-map__open"
              href={openUrl(location.mapQuery)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Google Maps
              <ExternalLink aria-hidden="true" size={14} strokeWidth={2} />
            </a>
          </div>

          <p className="rw-map__note">
            {isShown
              ? 'This map is served by Google.'
              : 'The map loads from Google only when you choose to show it.'}
          </p>
        </div>

        <div className="rw-map__frame">
          {isShown ? (
            <>
              {isLoaded ? null : (
                <p className="rw-map__status" role="status">
                  Loading map
                </p>
              )}
              <iframe
                ref={frameRef}
                className="rw-map__iframe"
                src={embedUrl(location.mapQuery)}
                title={`Map of ${place}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                onLoad={() => setIsLoaded(true)}
              />
            </>
          ) : (
            <button
              type="button"
              className="rw-map__placeholder"
              onClick={() => setIsShown(true)}
              aria-label={`Show map of ${place}`}
            >
              <MapPin aria-hidden="true" size={40} strokeWidth={1.75} />
              <span>{location.area ?? location.town}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
