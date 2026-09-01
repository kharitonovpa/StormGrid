import { describe, it, expect } from 'bun:test'
import { countryToCrop } from '../regionCrop.js'

describe('countryToCrop', () => {
  it('maps an Asian country to rice', () => {
    expect(countryToCrop('JP')).toBe('rice')
    expect(countryToCrop('IN')).toBe('rice')
  })

  it('maps an Americas country to corn', () => {
    expect(countryToCrop('US')).toBe('corn')
    expect(countryToCrop('BR')).toBe('corn')
  })

  it('maps a European country to wheat', () => {
    expect(countryToCrop('DE')).toBe('wheat')
    expect(countryToCrop('FR')).toBe('wheat')
  })

  it('falls back to wheat for a country outside all three buckets', () => {
    expect(countryToCrop('ZA')).toBe('wheat') // South Africa
    expect(countryToCrop('AU')).toBe('wheat') // Australia
  })

  it('falls back to wheat for null or unrecognized input', () => {
    expect(countryToCrop(null)).toBe('wheat')
    expect(countryToCrop('XX')).toBe('wheat')
    expect(countryToCrop('')).toBe('wheat')
  })

  it('is case-insensitive', () => {
    expect(countryToCrop('jp')).toBe('rice')
  })
})
