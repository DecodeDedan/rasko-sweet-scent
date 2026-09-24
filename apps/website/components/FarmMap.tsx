'use client'

import { useState } from 'react'
import { ExternalLink, MapPin } from 'lucide-react'

import { site } from '../content/site'

/**
 * Where the farm is: a card above the footer with the Google map shown
 * directly, so a visitor sees the location without pressing anything
 * (project owner, 2026-09-24). The privacy notice says the frame loads with
 * the page; change one and change app/privacy/page.tsx too.
 *
 * The frame carries Google's own "View larger map" link, and "Open in Google
 * Maps" beside it is the way out that always works: an iframe does not report
 * failure, so there is no error state to draw.
 */

// Close enough to pick out the farm and the roads leading to it.
const EMBED_ZOOM = 14

function embedUrl(query: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=${EMBED_ZOOM}&output=embed`
}

function openUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function FarmMap() {
  const { location, map } = site
  const [isLoaded, setIsLoaded] = useState(false)

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
            <a
              className="rw-button rw-map__open"
              href={openUrl(location.mapQuery)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Google Maps
              <ExternalLink aria-hidden="true" size={14} strokeWidth={2} />
            </a>
          </div>

          <p className="rw-map__note">This map is served by Google.</p>
        </div>

        <div className="rw-map__frame">
          {isLoaded ? null : (
            <p className="rw-map__status" role="status">
              Loading map
            </p>
          )}
          <iframe
            className="rw-map__iframe"
            src={embedUrl(location.mapQuery)}
            title={`Map of ${place}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => setIsLoaded(true)}
          />
        </div>
      </div>
    </section>
  )
}
