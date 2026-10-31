// Amendment 01B — pure media subject helpers.
import { describe, expect, it } from 'vitest';
import {
  APP_SLOTS,
  characterOfMoveId,
  characterSubject,
  extensionForMime,
  guessMime,
  isKnownSubject,
  kindFitsSubject,
  kindsForSubject,
  mimeFitsKind,
  moveSubject,
  rankSubject,
  subjectLabel,
  wavuMoveId,
  type UnmatchedCheck,
} from '../../../src/domain/media/subjects';

const ROSTER = ['Jack-8', 'Jin', 'Kazuya', 'Yoshimitsu', 'Devil Jin'];
const CHECK: UnmatchedCheck = {
  ranks: ['Beginner', 'Tekken King'],
  roster: ROSTER,
  yoshimitsuMoveIds: new Set(['Yoshimitsu-1,2', 'Yoshimitsu-b+1+4']),
};

describe('subject keys', () => {
  it('builds the four subject shapes', () => {
    expect(characterSubject('Yoshimitsu')).toBe('character:Yoshimitsu');
    expect(moveSubject('Yoshimitsu-1,2')).toBe('move:Yoshimitsu-1,2');
    expect(rankSubject('Tekken King')).toBe('rank:Tekken King');
    expect(APP_SLOTS).toEqual(['logo', 'key-art']);
  });

  it('lists the kinds each subject accepts', () => {
    expect(kindsForSubject('character:Jin')).toEqual(['character-icon', 'character-portrait']);
    expect(kindsForSubject('move:Jin-1,2')).toEqual(['move-clip']);
    expect(kindsForSubject('rank:Beginner')).toEqual(['rank-badge']);
    expect(kindsForSubject('app:logo')).toEqual(['game-logo']);
    expect(kindsForSubject('app:key-art')).toEqual(['key-art']);
    expect(kindsForSubject('app:wallpaper')).toEqual([]);
    expect(kindsForSubject('matchSet:abc')).toEqual([]);
  });

  it('checks a kind against its subject', () => {
    expect(kindFitsSubject('character-icon', 'character:Jin')).toBe(true);
    expect(kindFitsSubject('move-clip', 'character:Jin')).toBe(false);
    expect(kindFitsSubject('game-logo', 'app:logo')).toBe(true);
    expect(kindFitsSubject('key-art', 'app:logo')).toBe(false);
  });
});

describe('MIME rules', () => {
  it('accepts video for clips and images for everything else', () => {
    expect(mimeFitsKind('move-clip', 'video/mp4')).toBe(true);
    expect(mimeFitsKind('move-clip', 'VIDEO/WEBM')).toBe(true);
    expect(mimeFitsKind('move-clip', 'video/quicktime')).toBe(true);
    expect(mimeFitsKind('move-clip', 'image/png')).toBe(false);
    expect(mimeFitsKind('character-icon', 'image/png')).toBe(true);
    expect(mimeFitsKind('rank-badge', 'image/avif')).toBe(true);
    expect(mimeFitsKind('character-portrait', 'video/mp4')).toBe(false);
    expect(mimeFitsKind('character-icon', 'image/svg+xml')).toBe(false);
  });

  it('guesses a MIME type from the browser, else the extension', () => {
    expect(guessMime('clip.mp4', 'video/mp4')).toBe('video/mp4');
    expect(guessMime('clip.MOV', '')).toBe('video/quicktime');
    expect(guessMime('art.jpeg', 'application/octet-stream')).toBe('image/jpeg');
    expect(guessMime('art.webp')).toBe('image/webp');
    expect(guessMime('notes.txt')).toBe('application/octet-stream');
    expect(guessMime('noextension')).toBe('application/octet-stream');
  });

  it('maps a MIME type back to an extension', () => {
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('IMAGE/JPEG')).toBe('jpg');
    expect(extensionForMime('video/quicktime')).toBe('mov');
    expect(extensionForMime('application/zip')).toBe('bin');
  });
});

describe('Wavu move ids', () => {
  it('joins a character and an input', () => {
    expect(wavuMoveId('Yoshimitsu', '1,2')).toBe('Yoshimitsu-1,2');
  });

  it('finds the character with the longest matching name, so hyphenated names work', () => {
    expect(characterOfMoveId('Jack-8-1,2', ROSTER)).toBe('Jack-8');
    expect(characterOfMoveId('Jin-1,2', ROSTER)).toBe('Jin');
    expect(characterOfMoveId('Devil Jin-b+4', ROSTER)).toBe('Devil Jin');
    expect(characterOfMoveId('Nobody-1', ROSTER)).toBeNull();
  });
});

describe('labels and matching', () => {
  it('labels each subject type', () => {
    expect(subjectLabel('character:Jin')).toBe('Jin');
    expect(subjectLabel('rank:Tekken King')).toBe('Tekken King');
    expect(subjectLabel('app:logo')).toBe('App logo');
    expect(subjectLabel('app:key-art')).toBe('Key art');
    expect(subjectLabel('move:Yoshimitsu-1,2')).toBe('Yoshimitsu 1,2');
  });

  it('splits hyphenated names from the input when given the roster', () => {
    expect(subjectLabel('move:Jack-8-1,2', ROSTER)).toBe('Jack-8 1,2');
    expect(subjectLabel('move:Jack-8-1,2')).toBe('Jack 8-1,2');
    expect(subjectLabel('move:Nobody-1', ROSTER)).toBe('Nobody 1');
  });

  it('knows roster characters, ranks and app slots', () => {
    expect(isKnownSubject('character:Kazuya', CHECK)).toBe(true);
    expect(isKnownSubject('character:Akuma', CHECK)).toBe(false);
    expect(isKnownSubject('rank:Tekken King', CHECK)).toBe(true);
    expect(isKnownSubject('rank:God', CHECK)).toBe(false);
    expect(isKnownSubject('app:logo', CHECK)).toBe(true);
    expect(isKnownSubject('app:banner', CHECK)).toBe(false);
    expect(isKnownSubject('matchSet:1', CHECK)).toBe(false);
  });

  it('knows Yoshimitsu moves from the pack and accepts any opponent move id', () => {
    expect(isKnownSubject('move:Yoshimitsu-1,2', CHECK)).toBe(true);
    expect(isKnownSubject('move:Yoshimitsu-9,9,9', CHECK)).toBe(false);
    expect(isKnownSubject('move:Kazuya-f,n,d,df+2', CHECK)).toBe(true);
    expect(isKnownSubject('move:Kazuya-', CHECK)).toBe(false);
    expect(isKnownSubject('move:Akuma-1', CHECK)).toBe(false);
  });
});
