// Spec §4.7 — spoken labels for notation and frame values (screen-reader / audio cues).

import { tokenize, type NotationToken } from './tokenize';

const DIRECTION_NAMES: Record<string, string> = {
  u: 'up', d: 'down', f: 'forward', b: 'back', n: 'neutral',
  uf: 'up-forward', df: 'down-forward', ub: 'up-back', db: 'down-back',
};

const PREFIX_SPEECH: Record<string, string> = {
  H: 'Heat', R: 'Rage', P: 'after parry', J: 'jumping',
  KIN: 'Kincho', DGF: 'Dragonfly', NSS: 'No Sword Stance', FLE: 'Flea',
  IND: 'Indian Stance', MED: 'Meditation', BDS: 'Bad Breath',
  WFL: 'WFL', '1SS': '1SS',
};

const STATE_SPEECH: Record<string, string> = {
  WS: 'while standing', FC: 'full crouch', HFC: 'half crouch', BT: 'back-turned',
  SS: 'sidestep', SSL: 'sidestep left', SSR: 'sidestep right',
  SW: 'sidewalk', SWL: 'sidewalk left', SWR: 'sidewalk right',
  WR: 'while running', CD: 'crouch dash',
  FUFT: 'face-up feet-toward', FUFA: 'face-up feet-away',
  FDFT: 'face-down feet-toward', FDFA: 'face-down feet-away', OTG: 'on the ground',
};

const SHORTHAND_SPEECH: Record<string, string> = {
  cc: 'crouch cancel', ss: 'sidestep', dash: 'dash', md: 'micro dash',
  qcf: 'quarter-circle forward', qcb: 'quarter-circle back',
  hcf: 'half-circle forward', hcb: 'half-circle back',
  dp: 'dragon punch', iws: 'instant while standing', iwr: 'instant while running',
};

const EFFECT_SPEECH: Record<string, string> = {
  'T!': 'tornado', 'W!': 'wall splat', 'WB!': 'wall break', 'F!': 'floor break',
  'BB!': 'balcony break', 'B!': 'bound', 'S!': 'screw',
};

function speakParen(text: string): string {
  const inner = text.slice(1, -1);
  if (/^x\d+$/i.test(inner)) return `repeat ${inner.slice(1)} times`;
  const spoken = spokenChunk(inner);
  if (spoken === '') return text;
  // A parenthesised single button/direction in Wavu combo notation is a held input.
  if (/^[A-Za-z0-9+]+$/.test(inner) && tokenize(inner).length <= 3) return `held ${spoken}`;
  return spoken;
}

function tokenPhrase(token: NotationToken): string | null {
  switch (token.type) {
    case 'dir': {
      const name = DIRECTION_NAMES[token.text.toLowerCase()] ?? token.text;
      return token.hold ? `hold ${name}` : name;
    }
    case 'button':
      return token.text;
    case 'prefix': {
      const bare = token.text.endsWith('.') ? token.text.slice(0, -1) : token.text;
      const upper = bare.toUpperCase();
      const name = PREFIX_SPEECH[bare] ?? PREFIX_SPEECH[upper] ?? STATE_SPEECH[upper] ?? bare;
      return `${name}:`;
    }
    case 'state': {
      const name = STATE_SPEECH[token.text.toUpperCase()] ?? token.text;
      return `${name}:`;
    }
    case 'literal': {
      if (token.text.startsWith('(') && token.text.endsWith(')')) return speakParen(token.text);
      const effect = EFFECT_SPEECH[token.text];
      if (effect !== undefined) return effect;
      const shorthand = SHORTHAND_SPEECH[token.text.toLowerCase()];
      if (shorthand !== undefined) return shorthand;
      const frame = /^i(\d+)(?:~(\d+))?$/i.exec(token.text);
      if (frame !== null) {
        return frame[2] !== undefined
          ? `impact ${frame[1]} to ${frame[2]}`
          : `impact ${frame[1] as string}`;
      }
      return token.text;
    }
    case 'conn': {
      if (token.text === '+') return 'plus';
      if (token.text === '~') return 'immediately';
      if (token.text === ':') return 'tight';
      if (token.text === '<' || token.text === '>') return 'delay';
      if (token.text === '#') return 'same frame';
      if (token.text === '_') return 'or';
      if (token.text === '*') return 'held';
      return null; // ',' and '.' are structural separators, handled by the caller.
    }
    default:
      return token.text;
  }
}

/** Speak one whitespace-free chunk; ',' splits the chunk into comma-joined phrases. */
function spokenChunk(chunk: string): string {
  const tokens = tokenize(chunk);
  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (token.type === 'conn' && token.text === ',') {
      segments.push([]);
      continue;
    }
    const phrase = tokenPhrase(token);
    if (phrase !== null && phrase !== '') {
      const current = segments[segments.length - 1];
      if (current !== undefined) current.push(phrase);
    }
  }
  return segments
    .map((segment) => segment.join(' '))
    .filter((segment) => segment !== '')
    .join(', ');
}

export function spokenLabel(input: string): string {
  if (typeof input !== 'string' || input.trim() === '') return '';
  const chunks = input
    .trim()
    .split(/\s+/)
    .map(spokenChunk)
    .filter((part) => part !== '');
  // A chunk ending in a prefix colon ("Heat:", "face-up feet-toward:") joins
  // its move with a space, not a comma: "Heat: 2 plus 3".
  return chunks.reduce((joined, chunk) => {
    if (joined === '') return chunk;
    return joined.endsWith(':') ? `${joined} ${chunk}` : `${joined}, ${chunk}`;
  }, '');
}

// Spec §4.7 suffix tooltips, verbatim in meaning.
const FRAME_SUFFIX_SPEECH: Record<string, string> = {
  a: 'opponent airborne',
  b: 'recovers back-turned',
  c: 'opponent crouching',
  d: 'downed',
  g: 'opponent can guard during recovery',
  s: 'stagger',
  w: 'wall crush',
};

function speakSignedNumber(token: string): string {
  const match = /^([+-]?)([0-9]+)(?:~([+-]?)([0-9]+))?([a-zA-Z]?)$/.exec(token);
  if (match === null) return token;
  const signWord = match[1] === '-' ? 'minus ' : match[1] === '+' ? 'plus ' : '';
  let out = `${signWord}${match[2] as string}`;
  if (match[4] !== undefined) {
    const rangeSign = match[3] === '-' ? 'minus ' : match[3] === '+' ? 'plus ' : '';
    out += ` to ${rangeSign}${match[4]}`;
  }
  const suffix = match[5] as string;
  if (suffix !== '') {
    const phrase = FRAME_SUFFIX_SPEECH[suffix.toLowerCase()];
    out += phrase !== undefined ? `, ${phrase}` : `, ${suffix}`;
  }
  return out;
}

export function spokenFrameValue(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const trimmed = value.trim();
  if (trimmed === '-' || trimmed === '—' || trimmed === '–') return 'no frame value';
  // Normalise the typographic minus so parsing and speaking agree.
  const normalised = trimmed.replace(/−/g, '-');
  // Split off a parenthesised second value ("+34a (+24)"): speak it as a second value.
  const paren = /^([^()]+?)\s*\(([^()]*)\)\s*$/.exec(normalised);
  if (paren !== null && paren[1] !== undefined && paren[2] !== undefined) {
    const main = spokenFrameValue(paren[1]);
    const second = speakSignedNumber(paren[2].trim());
    return `${main}, second value ${second}`;
  }
  const parts = normalised.split(/\s+/).filter((part) => part !== '');
  return parts.map(speakSignedNumber).join(', ');
}
