// Spec §4.7 — spoken labels for notation and frame values.
import { spokenFrameValue, spokenLabel } from '../../../src/domain/notation/speak';

describe('spokenLabel', () => {
  it.each([
    ['df+2', 'down-forward plus 2'],
    ['H.2+3', 'Heat: 2 plus 3'],
    ['f,n,d,df+2', 'forward, neutral, down, down-forward plus 2'],
    ['KIN.f+1+2', 'Kincho: forward plus 1 plus 2'],
    ['FC.DF+1', 'full crouch: hold down-forward plus 1'],
    ['3~4', '3 immediately 4'],
    ['1+4', '1 plus 4'],
    ['qcf+2', 'quarter-circle forward plus 2'],
    ['ws4', 'while standing: 4'],
    ['BT.1', 'back-turned: 1'],
    ['H.DGF.4', 'Heat: Dragonfly: 4'],
    ['F+3', 'hold forward plus 3'],
    ['d+2,2,B', 'down plus 2, 2, hold back'],
    ['NSS.1+4', 'No Sword Stance: 1 plus 4'],
    ['MED.3', 'Meditation: 3'],
    ['R.df+1+2', 'Rage: down-forward plus 1 plus 2'],
    ['cc', 'crouch cancel'],
    ['iws', 'instant while standing'],
    ['ub+1+3,n,1', 'up-back plus 1 plus 3, neutral, 1'],
    ['df+2 1+4', 'down-forward plus 2, 1 plus 4'],
    ['H.2+3 T!', 'Heat: 2 plus 3, tornado'],
    ['hFC.df+4', 'half crouch: down-forward plus 4'],
    ['FUFT 3', 'face-up feet-toward: 3'],
    ['', ''],
  ])('spokenLabel(%s) = %s', (input, expected) => {
    expect(spokenLabel(input)).toBe(expected);
  });
});

describe('spokenFrameValue', () => {
  it.each([
    ['-14c', 'minus 14, opponent crouching'],
    ['+5g', 'plus 5, opponent can guard during recovery'],
    ['-9~-8', 'minus 9 to minus 8'],
    ['+34a (+24)', 'plus 34, opponent airborne, second value plus 24'],
    ['-20', 'minus 20'],
    ['+1', 'plus 1'],
    ['0', '0'],
    ['+14 +64a', 'plus 14, plus 64, opponent airborne'],
    ['-14b', 'minus 14, recovers back-turned'],
    ['+20d', 'plus 20, downed'],
    ['+5s', 'plus 5, stagger'],
    ['+3w', 'plus 3, wall crush'],
    ['−13', 'minus 13'],
    ['', ''],
  ])('spokenFrameValue(%s) = %s', (input, expected) => {
    expect(spokenFrameValue(input)).toBe(expected);
  });
});
