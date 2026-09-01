import type { CharacterType } from '@wheee/shared'

/**
 * Suggests a crop for a first-time player based on connection country,
 * reflecting each crop's real-world region (rice paddies of Asia, corn's
 * Americas origin, wheat across Europe). Europe has no explicit list below:
 * DEFAULT_CROP is wheat, which is already Europe's crop, so leaving Europe —
 * along with Africa, Oceania, and anything unrecognized — to fall through to
 * the default does the right thing without a redundant list.
 */
const DEFAULT_CROP: CharacterType = 'wheat'

const ASIA = new Set([
  'CN', 'JP', 'KR', 'KP', 'IN', 'ID', 'TH', 'VN', 'PH', 'MY', 'SG', 'MM',
  'KH', 'LA', 'BD', 'PK', 'LK', 'NP', 'MN', 'TW', 'HK', 'MO', 'BN', 'TL',
  'KZ', 'UZ', 'TM', 'TJ', 'KG',
  'AE', 'SA', 'IL', 'TR', 'IR', 'IQ', 'JO', 'LB', 'SY', 'YE', 'OM', 'QA',
  'KW', 'BH', 'AF',
])

const AMERICAS = new Set([
  'US', 'CA', 'MX',
  'BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'BO', 'PY', 'UY', 'GY', 'SR',
  'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'BZ',
  'CU', 'DO', 'HT', 'JM', 'TT', 'BS', 'BB',
])

export function countryToCrop(countryCode: string | null): CharacterType {
  if (!countryCode) return DEFAULT_CROP
  const code = countryCode.toUpperCase()
  if (ASIA.has(code)) return 'rice'
  if (AMERICAS.has(code)) return 'corn'
  return DEFAULT_CROP
}
